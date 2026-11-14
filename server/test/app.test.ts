import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createApp, type Deps } from '../src/app.ts'
import type { Identity, IdentityRepo, MfaRepo, MfaRow, Tier, UserRepo, UserRow } from '../src/db.ts'
import { totpCode } from '../src/totp.ts'
import { PdsError, type PdsClient } from '../src/pds.ts'
import { createOAuthClient, type ExternalProfile, type OAuthClient, type OAuthProviderId } from '../src/providers.ts'
import { createSecretBox } from '../src/secretbox.ts'
import type { Settings, SettingsRepo } from '../src/settings.ts'
import type { PaidContentRow, PaidRepo } from '../src/paidContent.ts'
import type { DeveloperRepo, OAuthClientRow, PersonalTokenRow } from '../src/developer.ts'
import type { LavaClient, LavaInvoiceInfo, OrderRepo, OrderRow } from '../src/lava.ts'
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose'
import { createStaffVerifier, type AuditEntry, type AuditRepo } from '../src/staff.ts'
import type { ClaimRepo, ClaimRow } from '../src/claims.ts'
import type { MessageRow, TicketRepo, TicketRow } from '../src/tickets.ts'
import type { AtprotoAuth } from '../src/atprotoOAuth.ts'
import type { ImportDraftRow, ImportRepo, PostSource } from '../src/imports.ts'
import type { MailboxClient, MailboxId, MailMessage } from '../src/mailbox.ts'
import type { PayoutRepo, PayoutRow } from '../src/payouts.ts'
import type { SessionRepo, SessionRow } from '../src/sessions.ts'

/** тестовый «Zitadel»: свой ключ подписи и выпуск access-токенов с ролями проекта */
const ZITADEL = 'https://auth.test'
const PROJECT_ID = 'proj-1'
const zKeys = await generateKeyPair('RS256')
const zJwks = createLocalJWKSet({ keys: [{ ...(await exportJWK(zKeys.publicKey)), kid: 'k1', alg: 'RS256' }] })
const staffToken = (roles: string[], o: { iss?: string; aud?: string; exp?: string; sub?: string } = {}) =>
  new SignJWT({ name: 'Оператор', [`urn:zitadel:iam:org:project:${PROJECT_ID}:roles`]: Object.fromEntries(roles.map((r) => [r, { org1: 'weat.media' }])) })
    .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
    .setIssuer(o.iss ?? ZITADEL)
    .setAudience(o.aud ?? PROJECT_ID)
    .setSubject(o.sub ?? 'u-42')
    .setIssuedAt()
    .setExpirationTime(o.exp ?? '5m')
    .sign(zKeys.privateKey)
function memClaims(): ClaimRepo {
  const rows: ClaimRow[] = []
  const active = (r: ClaimRow) => r.status !== 'rejected'
  return {
    async insert(c) {
      if (rows.some((r) => active(r) && r.source_site === c.source_site && r.source_author.toLowerCase() === c.source_author.toLowerCase())) return null
      const row: ClaimRow = { ...c, status: 'pending', decision_note: null, decided_by: null, decided_at: null, created_at: new Date() }
      rows.push(row)
      return row
    },
    async byClaimant(did) { return rows.filter((r) => r.claimant_did === did) },
    async get(id) { return rows.find((r) => r.id === id) },
    async list(status) { return rows.filter((r) => !status || r.status === status) },
    async decide(id, status, by, note) {
      const r = rows.find((x) => x.id === id && x.status === 'pending')
      if (r) Object.assign(r, { status, decided_by: by, decision_note: note, decided_at: new Date() })
      return r
    },
  }
}

function memImports(): ImportRepo {
  const rows: ImportDraftRow[] = []
  return {
    async insertMany(drafts) {
      let n = 0
      for (const d of drafts) {
        if (rows.some((r) => r.did === d.did && r.source_uri === d.source_uri)) continue
        rows.push({ ...d, status: 'pending', article_uri: null, created_at: new Date(), updated_at: new Date() })
        n++
      }
      return n
    },
    async list(did, status) {
      return rows.filter((r) => r.did === did && (!status || r.status === status)).sort((a, b) => +b.source_created_at - +a.source_created_at)
    },
    async get(did, id) {
      return rows.find((r) => r.did === did && r.id === id)
    },
    async setStatus(did, id, status, articleUri) {
      const r = rows.find((x) => x.did === did && x.id === id)
      if (r) Object.assign(r, { status, article_uri: articleUri, updated_at: new Date() })
      return r
    },
  }
}

/** публичный репозиторий внешнего AT-аккаунта: два поста, ответ и пост с картинкой и ссылкой */
const fakePostSource: PostSource = {
  async posts(did) {
    const at = (rkey: string) => `at://${did}/app.bsky.feed.post/${rkey}`
    return {
      pds: 'https://ext.pds',
      records: [
        { uri: at('1'), cid: 'c1', value: { text: 'Первый пост\n\nвторой абзац', createdAt: '2026-01-01T10:00:00Z' } },
        { uri: at('2'), cid: 'c2', value: { text: 'ответ', reply: { root: {}, parent: {} }, createdAt: '2026-01-02T10:00:00Z' } },
        {
          uri: at('3'),
          cid: 'c3',
          value: {
            text: 'Смотри сайт',
            createdAt: '2026-01-03T10:00:00Z',
            facets: [{ index: { byteStart: 13, byteEnd: 21 }, features: [{ $type: 'app.bsky.richtext.facet#link', uri: 'https://x.org' }] }],
            embed: { $type: 'app.bsky.embed.images', images: [{ alt: 'кот', image: { ref: { $link: 'bafyimg' } } }] },
          },
        },
      ],
    }
  },
}

/** почтовые ящики в памяти: письмо 1 в support@ и legal@; отправленное — в sent */
let mailSent: { box: MailboxId; to: string; subject: string; inReplyTo?: string }[] = []
function memMail(): MailboxClient {
  const msg = (box: MailboxId): MailMessage => ({
    uid: 1, from: 'Читатель <reader@example.com>', to: `${box}@weat.media`, subject: `Вопрос в ${box}`, date: '2026-11-13T10:00:00.000Z',
    seen: false, hasAttachments: true, messageId: `<m1-${box}@example.com>`, replyTo: null, text: 'Здравствуйте', references: [],
    attachments: [{ id: '0', filename: 'скан.pdf', contentType: 'application/pdf', size: 3 }],
  })
  return {
    configured: () => ['support', 'legal', 'noreply'],
    async list(box) {
      const { text: _t, references: _r, attachments: _a, messageId: _m, replyTo: _p, ...summary } = msg(box)
      return { messages: [summary], nextBeforeUid: null }
    },
    async get(box, uid) {
      return uid === 1 ? { ...msg(box), seen: true } : null
    },
    async attachment(_box, uid, id) {
      return uid === 1 && id === '0' ? { filename: 'скан.pdf', contentType: 'application/pdf', content: Buffer.from('pdf') } : null
    },
    async send(box, m) {
      mailSent.push({ box, to: m.to, subject: m.subject, inReplyTo: m.inReplyTo })
      return { messageId: '<sent@weat.media>' }
    },
  }
}

/** оплаченные продажи для выплат: тест кладёт их сюда напрямую */
let paidSales: { author: string; share: number; currency: string; paidAt: Date; title: string }[] = []
function memPayouts(): PayoutRepo {
  const rows: PayoutRow[] = []
  const balances: PayoutRepo['balances'] = async (did, holdDays) => {
    const cur = new Set([...paidSales.filter((x) => x.author === did).map((x) => x.currency), ...rows.filter((x) => x.author_did === did).map((x) => x.currency)])
    const since = Date.now() - holdDays * 86_400_000
    return [...cur].sort().map((currency) => {
      const mine = paidSales.filter((x) => x.author === did && x.currency === currency)
      const earned = mine.reduce((a, x) => a + x.share, 0)
      const pending = mine.filter((x) => +x.paidAt > since).reduce((a, x) => a + x.share, 0)
      const po = rows.filter((x) => x.author_did === did && x.currency === currency)
      const reserved = po.filter((x) => x.status === 'requested').reduce((a, x) => a + x.amount, 0)
      const paidOut = po.filter((x) => x.status === 'paid').reduce((a, x) => a + x.amount, 0)
      return { currency, earned, pending, reserved, paidOut, available: Math.max(0, earned - pending - reserved - paidOut) }
    })
  }
  return {
    balances,
    async sales(did) {
      return paidSales.filter((x) => x.author === did).map((x, i) => ({ orderId: `ord_${i}`, title: x.title, amount: x.share * 2, authorShare: x.share, currency: x.currency, paidAt: x.paidAt }))
    },
    async list(did) { return rows.filter((x) => x.author_did === did) },
    async request(p, holdDays) {
      const b = (await balances(p.author_did, holdDays)).find((x) => x.currency === p.currency)
      if (!b || b.available < p.amount) return null
      const row: PayoutRow = { ...p, status: 'requested', staff_note: null, decided_by: null, created_at: new Date(), decided_at: null }
      rows.push(row)
      return row
    },
    async queue(status) { return rows.filter((x) => !status || x.status === status) },
    async get(id) { return rows.find((x) => x.id === id) },
    async decide(id, status, by, note) {
      const r = rows.find((x) => x.id === id && x.status === 'requested')
      if (r) Object.assign(r, { status, decided_by: by, staff_note: note, decided_at: new Date() })
      return r
    },
  }
}

function memTickets(): TicketRepo {
  const rows: TicketRow[] = []
  const msgs: MessageRow[] = []
  // порядок сообщений и «прочитано» — по счётчику, а не по часам: в тесте всё происходит в одну миллисекунду
  let tick = 0
  const at = () => new Date(Date.UTC(2026, 0, 1) + ++tick * 1000)
  return {
    async byDid(did) { return rows.filter((r) => r.did === did).reverse() },
    async messages(ids) { return msgs.filter((m) => ids.includes(m.ticket_id)) },
    async addMessage(m) {
      const row: MessageRow = { ...m, created_at: at() }
      msgs.push(row)
      return row
    },
    async markSeen(id) {
      const r = rows.find((x) => x.id === id)
      if (r) r.user_seen_at = at()
    },
    async insert(t) {
      const row: TicketRow = { ...t, status: 'new', staff_note: null, updated_by: null, created_at: new Date(), updated_at: new Date() }
      rows.push(row)
      return row
    },
    async get(id) { return rows.find((r) => r.id === id) },
    async list(status) { return rows.filter((r) => !status || r.status === status).reverse() },
    async update(id, patch, by) {
      const r = rows.find((x) => x.id === id)
      if (r) Object.assign(r, { ...(patch.status ? { status: patch.status } : {}), ...(patch.staff_note !== undefined ? { staff_note: patch.staff_note } : {}), updated_by: by, updated_at: new Date() })
      return r
    },
  }
}

function memSessions(): SessionRepo {
  const rows: SessionRow[] = []
  let n = 0
  return {
    async record(s) {
      const prev = s.prevRefreshHash ? rows.find((r) => r.refresh_hash === s.prevRefreshHash && !r.revoked_at) : undefined
      if (prev) return void Object.assign(prev, { access_hash: s.accessHash, refresh_hash: s.refreshHash, last_seen_at: new Date(), country: s.country })
      rows.push({ id: `ses_${++n}`, did: s.did, access_hash: s.accessHash, refresh_hash: s.refreshHash, device: s.device, country: s.country, created_at: new Date(), last_seen_at: new Date(), revoked_at: null, revoked_by: null })
    },
    async isRevoked(h) {
      const hit = rows.filter((r) => r.access_hash === h || r.refresh_hash === h)
      return hit.length > 0 && hit.every((r) => !!r.revoked_at)
    },
    async byAccess(h) { return rows.filter((r) => r.access_hash === h).sort((a, b) => Number(!!a.revoked_at) - Number(!!b.revoked_at))[0] },
    async list(did) { return rows.filter((r) => r.did === did) },
    async revoke(did, ids, by, keep) {
      const hit = rows.filter((r) => r.did === did && !r.revoked_at && (ids ? ids.includes(r.id) : r.id !== keep))
      for (const r of hit) Object.assign(r, { revoked_at: new Date(), revoked_by: by })
      return hit.length
    },
  }
}

const auditLog: AuditEntry[] = []
const memAudit: AuditRepo = {
  async log(e) { auditLog.push({ ...e, at: new Date().toISOString() }) },
  async recent(n) { return auditLog.slice(-n).reverse() },
}

function memRepo(): UserRepo {
  const rows = new Map<string, UserRow>()
  return {
    async insert(u) {
      const row: UserRow = {
        did: u.did,
        handle: u.handle,
        display_name: u.displayName ?? null,
        signup_country: u.signupCountry,
        tier: 'free',
        premium_since: null,
        created_at: new Date('2026-11-12T10:00:00Z'),
        password_login: u.passwordLogin ?? true,
        signup_utm: u.signupUtm ?? null,
      }
      rows.set(u.did, rows.get(u.did) ?? row)
      return rows.get(u.did)!
    },
    async findByDid(did) {
      return rows.get(did)
    },
    async findByHandleOrDid(id) {
      return [...rows.values()].find((r) => r.did === id || r.handle === id.toLowerCase())
    },
    async setPasswordLogin(did, v) {
      const r = rows.get(did)
      if (r) r.password_login = v
    },
    async setDisplayName(did, name) {
      const r = rows.get(did)
      if (r) r.display_name = name
    },
    async search(q, limit) {
      const t = q.trim().toLowerCase()
      return [...rows.values()].filter((r) => !t || r.did === t || r.handle.startsWith(t)).slice(0, limit)
    },
    async setResidence(did, country) {
      const r = rows.get(did)
      if (r) r.residence_country = country
      return r
    },
    async setTier(did, tier: Tier) {
      const r = rows.get(did)
      if (!r) return undefined
      r.tier = tier
      r.premium_since = tier === 'premium' ? new Date() : null
      return r
    },
  }
}

function memSettings(): SettingsRepo {
  const rows = new Map<string, Settings>()
  return {
    async get(did) {
      return { data: rows.get(did) ?? {}, updatedAt: rows.has(did) ? new Date().toISOString() : null }
    },
    async merge(did, patch) {
      const data = { ...rows.get(did), ...patch }
      rows.set(did, data)
      return { data, updatedAt: new Date().toISOString() }
    },
  }
}

function memIdentities(): IdentityRepo {
  let rows: Identity[] = []
  return {
    async find(provider, id) {
      return rows.find((r) => r.provider === provider && r.providerUserId === id)
    },
    async listByDid(did) {
      return rows.filter((r) => r.did === did)
    },
    async insert(i) {
      rows.push({ ...i, createdAt: new Date() })
    },
    async updateSecret(did, provider, enc, name) {
      const r = rows.find((x) => x.did === did && x.provider === provider)
      if (r) Object.assign(r, { pdsPasswordEnc: enc, appPasswordName: name })
    },
    async remove(did, provider) {
      const hit = rows.find((r) => r.did === did && r.provider === provider)
      rows = rows.filter((r) => r !== hit)
      return hit
    },
  }
}

function memMfa(): MfaRepo {
  const rows = new Map<string, MfaRow>()
  const lastStep = new Map<string, number>()
  const fails = new Map<string, { n: number; locked: number }>()
  const marked = new Set<string>()
  const used = new Set<string>()
  const get = (did: string) =>
    rows.get(did) ?? { totpSecretEnc: null, totpPendingEnc: null, totpEnabledAt: null, backupCodeHashes: [] }
  return {
    async get(did) {
      return { ...get(did) }
    },
    async setPending(did, enc) {
      rows.set(did, { ...get(did), totpPendingEnc: enc })
    },
    async enable(did, enc, hashes) {
      rows.set(did, { totpSecretEnc: enc, totpPendingEnc: null, totpEnabledAt: new Date(), backupCodeHashes: hashes })
    },
    async disable(did) {
      rows.delete(did)
    },
    async consumeBackupCode(did, hash) {
      const r = get(did)
      if (!r.backupCodeHashes.includes(hash)) return false
      rows.set(did, { ...r, backupCodeHashes: r.backupCodeHashes.filter((h) => h !== hash) })
      return true
    },
    async setBackupCodes(did, hashes) {
      rows.set(did, { ...get(did), backupCodeHashes: hashes })
    },
    async useTotpStep(did, step) {
      if ((lastStep.get(did) ?? -1) >= step) return false
      lastStep.set(did, step)
      return true
    },
    async lockedUntil(did) {
      const l = fails.get(did)?.locked
      return l && l > Date.now() ? new Date(l) : null
    },
    async recordFailure(did, max, _w, lockMs) {
      const f = fails.get(did) ?? { n: 0, locked: 0 }
      f.n++
      if (f.n >= max) Object.assign(f, { n: 0, locked: Date.now() + lockMs })
      fails.set(did, f)
    },
    async resetFailures(did) {
      fails.delete(did)
    },
    async markSessions(_did, hashes) {
      for (const h of hashes) marked.add(h)
    },
    async isSessionMarked(h) {
      return marked.has(h)
    },
    async consumeMfaToken(h) {
      if (used.has(h)) return false
      used.add(h)
      return true
    },
  }
}

function memPaid(): PaidRepo {
  const rows = new Map<string, PaidContentRow>()
  const ents: { readerDid: string; contentId?: string; authorDid?: string; tierId?: string; expiresAt?: Date; paymentRef?: string }[] = []
  return {
    async insert(r) { rows.set(r.id, { ...r, at_uri: null, created_at: new Date(), updated_at: new Date() }) },
    async setAtUri(id, uri) { rows.get(id)!.at_uri = uri },
    async get(id) { return rows.get(id) },
    async byAuthor(did) { return [...rows.values()].filter((r) => r.author_did === did) },
    async remove(id) { rows.delete(id) },
    async hasAccess(reader, c) {
      return ents.some((e) => e.readerDid === reader && (!e.expiresAt || e.expiresAt > new Date()) &&
        (e.contentId === c.id || (c.access_type === 'subscription' && e.authorDid === c.author_did && (!e.tierId || e.tierId === c.tier_id))))
    },
    async countSubscribers(author) {
      return new Set(ents.filter((e) => e.authorDid === author && !e.contentId && (!e.expiresAt || e.expiresAt > new Date())).map((e) => e.readerDid)).size
    },
    async grant(g) {
      if (g.paymentRef && ents.some((e) => e.paymentRef === g.paymentRef)) return false
      ents.push(g)
      return true
    },
  }
}

function memDeveloper(): DeveloperRepo {
  const tokens = new Map<string, PersonalTokenRow>()
  const clients = new Map<string, OAuthClientRow>()
  return {
    async insertToken(r) { tokens.set(r.id, { ...r, created_at: new Date(), last_used_at: null }) },
    async tokensOf(did) { return [...tokens.values()].filter((t) => t.did === did) },
    async tokenByHash(h) { return [...tokens.values()].find((t) => t.token_hash === h) },
    async touchToken(id) { tokens.get(id)!.last_used_at = new Date() },
    async rotateToken(did, id, hash, exp) {
      const t = tokens.get(id)
      if (!t || t.did !== did || (t.expires_at && t.expires_at <= new Date())) return undefined
      Object.assign(t, { token_hash: hash, expires_at: exp, last_used_at: null })
      return t
    },
    async expireToken(id) { const t = tokens.get(id); if (t) t.expires_at = new Date(Date.now() - 1) },
    async removeToken(did, id) {
      const t = tokens.get(id)
      if (!t || t.did !== did) return undefined
      tokens.delete(id)
      return t
    },
    async insertClient(r) { clients.set(r.client_id, { ...r, created_at: new Date(), secret_rotated_at: new Date() }) },
    async clientsOf(did) { return [...clients.values()].filter((c) => c.owner_did === did) },
    async updateClient(did, id, p) {
      const c = clients.get(id)
      if (!c || c.owner_did !== did) return undefined
      for (const [k, v] of Object.entries(p)) if (v !== undefined) (c as unknown as Record<string, unknown>)[k] = v
      if (p.secret_hash) c.secret_rotated_at = new Date()
      return c
    },
    async removeClient(did, id) { return clients.get(id)?.owner_did === did && clients.delete(id) },
  }
}

let ordersLast: OrderRepo | undefined

function memOrders(): OrderRepo {
  const rows = new Map<string, OrderRow>()
  return {
    async insert(o) { rows.set(o.id, { ...o, status: 'pending', created_at: new Date(), paid_at: null }) },
    async get(id) { return rows.get(id) },
    async byContract(c) { return [...rows.values()].find((o) => o.contract_id === c) },
    async settle(id, status) {
      const o = rows.get(id)
      if (!o || o.status !== 'pending') return false
      o.status = status
      return true
    },
  }
}

/** lava.top в тестах: счета и их статусы задаёт тест */
const lavaInvoices = new Map<string, LavaInvoiceInfo>()
const lavaRequests: Record<string, unknown>[] = []
const fakeLava: LavaClient = {
  async createInvoice(body) {
    lavaRequests.push(body)
    const id = `00000000-0000-4000-8000-${String(lavaRequests.length).padStart(12, '0')}`
    lavaInvoices.set(id, { id, status: 'NEW' })
    return { id, status: 'new', paymentUrl: `https://pay.lava.example/${id}` }
  },
  async getInvoice(id) { return lavaInvoices.get(id)! },
}

/** putRecord (профиль и т.п.) */
const stored = new Map<string, Record<string, unknown>>()

/** записи, которые попали в AT-репозитории (публично) */
const published: { repo: string; collection: string; record: Record<string, unknown> }[] = []

/** письма PDS в тестах: последние коды по типу */
const mailbox: { confirm?: string; reset?: string; twofa?: string; update?: string } = {}

const profiles: Record<string, ExternalProfile> = {
  'yandex:code-ivan': { id: '1001', login: 'ivan.petrov', email: 'ivan@yandex.ru', displayName: 'Иван Петров' },
  'telegram:code-tg': { id: '99', login: 'alina_tg', email: null, displayName: 'Alina' },
  'yandex:code-noemail': { id: '1002', login: 'ghost', email: null, displayName: null },
  'google:code-g': { id: 'g-42', login: 'alina@gmail.com', email: 'alina@gmail.com', displayName: 'Alina' },
  'github:code-gh': { id: '777', login: 'alina-dev', email: null, displayName: 'Alina' },
}
/** PKCE-провайдер (Telegram) отдаёт профиль, только если verifier из состояния дошёл до обмена кода */
const pkceSeen: (string | undefined)[] = []
const fakeOAuth = (p: OAuthProviderId, pkce = false): OAuthClient => ({
  pkce,
  authorizeUrl: (state, redirect, verifier) =>
    `https://${p}.example/authorize?state=${state}&redirect_uri=${encodeURIComponent(redirect)}${verifier ? `&code_challenge=${verifier.length}` : ''}`,
  async exchangeCode(code, _redirect, verifier) {
    if (pkce) {
      pkceSeen.push(verifier)
      if (!verifier || verifier.length < 43) throw new Error('no pkce verifier')
    }
    const prof = profiles[`${p}:${code}`]
    if (!prof) throw new Error('bad code')
    return prof
  },
})

/** токены: acc-<did> — полная сессия, app-<did> — сессия по app password */
let fakePdsLast: PdsClient | undefined

function fakePds(): PdsClient {
  const accounts = new Map<string, { did: string; password: string; app: Map<string, string>; email: string; confirmed: boolean; factor: boolean }>()
  const byDid = (did: string) => [...accounts.entries()].find(([, a]) => a.did === did)
  // у каждой сессии свои токены, как у настоящего PDS: acc-<did>~<n>
  let seq = 0
  const session = (handle: string, did: string, app = false) => {
    const n = ++seq
    return { did, handle, accessJwt: `${app ? 'app' : 'acc'}-${did}~${n}`, refreshJwt: `ref-${did}~${n}` }
  }
  const tokenUser = (jwt: string) => {
    const did = jwt.replace(/^(acc|app)-/, '').replace(/~\d+$/, '')
    const hit = byDid(did)
    if (!hit) throw new PdsError(401, 'InvalidToken', 'bad token')
    return { handle: hit[0], acct: hit[1], appPass: jwt.startsWith('app-') }
  }
  return {
    async createAccount({ handle, password, email }) {
      if (accounts.has(handle)) throw new PdsError(409, 'HandleTaken', 'Этот username уже занят')
      const did = `did:plc:${handle.split('.')[0]}`
      accounts.set(handle, { did, password, app: new Map(), email, confirmed: false, factor: false })
      return session(handle, did)
    },
    async createSession(identifier, password, authFactorToken) {
      // реальный PDS принимает handle или DID
      if (identifier.startsWith('did:')) identifier = byDid(identifier)?.[0] ?? identifier
      const a = accounts.get(identifier)
      if (a && a.password === password && a.factor) {
        if (!authFactorToken) {
          mailbox.twofa = 'TWOFA-1'
          throw new PdsError(401, 'AuthFactorTokenRequired', 'A sign in code has been sent to your email address')
        }
        if (authFactorToken !== mailbox.twofa) throw new PdsError(400, 'InvalidToken', 'Token is invalid')
      }
      if (a && a.password === password) return session(identifier, a.did)
      if (a && [...a.app.values()].includes(password)) return session(identifier, a.did, true)
      throw new PdsError(401, 'AuthenticationRequired', 'Invalid identifier or password')
    },
    async getSession(jwt) {
      const { handle, acct } = tokenUser(jwt)
      return { did: acct.did, handle, email: acct.email, emailConfirmed: acct.confirmed, emailAuthFactor: acct.factor }
    },
    async requestEmailConfirmation() {
      mailbox.confirm = 'CONF-1'
    },
    async confirmEmail(jwt, email, token) {
      const { acct } = tokenUser(jwt)
      if (token !== mailbox.confirm || email !== acct.email) throw new PdsError(400, 'InvalidToken', 'bad')
      acct.confirmed = true
    },
    async setEmailAuthFactor(jwt, _email, enabled, token) {
      const { acct } = tokenUser(jwt)
      if (!enabled && token !== mailbox.update) throw new PdsError(400, 'InvalidToken', 'bad')
      acct.factor = enabled
    },
    async requestEmailUpdate() {
      mailbox.update = 'UPD-123'
      return { tokenRequired: true }
    },
    async requestPasswordReset(email) {
      if ([...accounts.values()].some((a) => a.email === email)) mailbox.reset = `RESET-${email}`
    },
    async resetPassword(token, password) {
      const a = [...accounts.values()].find((x) => `RESET-${x.email}` === token)
      if (!a) throw new PdsError(400, 'ExpiredToken', 'Token has expired')
      a.password = password
    },
    async refreshSession(refreshJwt) {
      const did = refreshJwt.replace(/^ref-/, '').replace(/~\d+$/, '')
      const hit = byDid(did)
      if (!refreshJwt.startsWith('ref-') || !hit) throw new PdsError(401, 'ExpiredToken', 'expired')
      return session(hit[0], did)
    },
    async createAppPassword(jwt, name) {
      const u = tokenUser(jwt)
      if (u.appPass) throw new PdsError(400, 'InvalidToken', 'app passwords cannot create app passwords')
      const password = `app-pw-${name}`
      u.acct.app.set(name, password)
      return { password }
    },
    async revokeAppPassword(jwt, name) {
      tokenUser(jwt).acct.app.delete(name)
    },
    async adminUpdateHandle() {},
    async createRecord(jwt, repo, collection, record) {
      tokenUser(jwt)
      published.push({ repo, collection, record })
      return { uri: `at://${repo}/${collection}/r${published.length}`, cid: 'c' }
    },
    async putRecord(jwt, repo, collection, rkey, record) {
      tokenUser(jwt)
      stored.set(`${repo}/${collection}/${rkey}`, record)
      return { uri: `at://${repo}/${collection}/${rkey}`, cid: 'c' }
    },
    async getRecord(repo, collection, rkey) {
      const i = published.findIndex((p, n) => p.repo === repo && p.collection === collection && `r${n + 1}` === rkey)
      return stored.get(`${repo}/${collection}/${rkey}`) ?? (i >= 0 ? published[i]!.record : undefined)
    },
    async listRepos() {
      return { repos: [...accounts.values()].map((a) => ({ did: a.did })) }
    },
    async describeRepo(repo) {
      const hit = byDid(repo)
      if (!hit) throw new PdsError(400, 'RepoNotFound', 'no repo')
      return { did: repo, handle: hit[0] }
    },
    async listRecords(repo, collection) {
      return {
        records: published
          .map((p, i) => ({ ...p, rkey: `r${i + 1}` }))
          .filter((p) => p.repo === repo && p.collection === collection)
          .map((p) => ({ uri: `at://${repo}/${collection}/${p.rkey}`, cid: 'c', value: p.record })),
      }
    },
    async deleteRecord(jwt, repo, collection, rkey) {
      tokenUser(jwt)
      const i = published.findIndex((p) => p.repo === repo && `r${published.indexOf(p) + 1}` === rkey)
      if (i >= 0) published.splice(i, 1)
    },
  }
}

/** внешний AT-сервер: authorize кладёт state в URL, callback возвращает подтверждённый DID и email */
const fakeAtproto: AtprotoAuth = {
  clientMetadata: { client_id: 'http://localhost/client-metadata.json' } as AtprotoAuth['clientMetadata'],
  async authorize(handle, appState) {
    return `https://ext.pds/oauth/authorize?${new URLSearchParams({ handle, state: appState })}`
  },
  async callback(params) {
    const handle = params.get('handle')!
    return { did: `did:plc:${handle.replace(/\W/g, '')}`, handle, email: handle === 'noemail.ext' ? null : `${handle}@mail.ext`, appState: params.get('state') }
  },
}

function makeApp(opts: { rateLimit?: boolean; contour?: 'global' | 'ru'; ipCountry?: Record<string, string>; peer?: Deps['peer']; nodeRole?: 'primary' | 'standby'; atproto?: boolean } = {}) {
  const deps: Deps = {
    config: {
      CONTOUR: opts.contour ?? 'global',
      PDS_HANDLE_DOMAIN: 'indie.media',
      TRUST_PROXY: true,
      ADMIN_TOKEN: 'admin-token-0123456789',
      CORS_ORIGIN: 'http://localhost:3000',
      PUBLIC_URL: 'http://localhost:3000',
      LAVA_OFFER_ID: '836b9fc5-7ae9-4a27-9642-592bc44072b7',
      LAVA_WEBHOOK_SECRET: 'lava-webhook-secret-0123',
    },
    identities: memIdentities(),
    mfa: memMfa(),
    paid: memPaid(),
    developer: memDeveloper(),
    orders: (ordersLast = memOrders()),
    claims: memClaims(),
    tickets: memTickets(),
    sessions: memSessions(),
    imports: memImports(),
    mail: memMail(),
    payouts: memPayouts(),
    postSource: fakePostSource,
    staff: createStaffVerifier({ issuer: ZITADEL, projectId: PROJECT_ID, jwks: zJwks }),
    audit: memAudit,
    rateLimiter: opts.rateLimit ? undefined : false,
    lava: fakeLava,
    paidBox: createSecretBox('44'.repeat(32)),
    secrets: createSecretBox('11'.repeat(32)),
    oauth: { yandex: fakeOAuth('yandex'), google: fakeOAuth('google'), github: fakeOAuth('github'), telegram: fakeOAuth('telegram', true) },
    atproto: opts.atproto ? fakeAtproto : undefined,
    users: memRepo(),
    settings: memSettings(),
    pds: (fakePdsLast = fakePds()),
    geo: { country: (ip) => opts.ipCountry?.[ip] ?? 'ZZ' },
    socketIp: () => '127.0.0.1',
    peer: opts.peer,
    nodeRole: opts.nodeRole,
  }
  return createApp(deps)
}

const json = (body: unknown, ip: string, extra: Record<string, string> = {}) => ({
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-forwarded-for': ip, ...extra },
  body: JSON.stringify(body),
})

const reg = { username: 'Alina', email: 'alina@example.com', password: 'correct-horse', consent: { personalData: true, terms: true } }

test('register stores signup country and returns session', async () => {
  const app = makeApp({ ipCountry: { '5.1.1.1': 'DE' } })
  const res = await app.request('/api/auth/register', json(reg, '5.1.1.1'))
  assert.equal(res.status, 201)
  const body = await res.json()
  assert.equal(body.user.handle, 'alina.indie.media')
  assert.equal(body.user.signupCountry, 'DE')
  assert.equal(body.user.tier, 'free')
  assert.equal(body.user.createdAt, '2026-11-12T10:00:00.000Z')
  assert.ok(body.accessJwt)

  assert.equal(body.user.residenceCountry, 'DE', 'резидентство по умолчанию — страна регистрации')

  // страны — персональные данные: в публичном профиле их нет, владельцу — в /me
  const pub = await (await app.request('/api/users/alina.indie.media')).json()
  assert.equal(pub.signupCountry, undefined)
  assert.equal(pub.residenceCountry, undefined)
  const me = await (await app.request('/api/me', { headers: { authorization: `Bearer ${body.accessJwt}` } })).json()
  assert.equal(me.signupCountry, 'DE')

  // резидентство меняет поддержка по заявке; регистрация остаётся прежней, смена — в аудите
  const staff = { authorization: `Bearer ${await staffToken(['support'])}`, 'content-type': 'application/json' }
  const put = (b: unknown, h: Record<string, string> = staff) =>
    app.request(`/api/admin/users/${body.user.did}/residence`, { method: 'PUT', headers: h, body: JSON.stringify(b) })
  assert.equal((await put({ country: 'GE' }, { authorization: `Bearer ${body.accessJwt}`, 'content-type': 'application/json' })).status, 401, 'токен читателя — не сотрудник')
  assert.equal((await put({ country: 'georgia' })).status, 400)
  const movedRes = await put({ country: 'GE', ticket: 'T-42' })
  const moved = await movedRes.json()
  assert.equal(movedRes.status, 200, JSON.stringify(moved))
  assert.equal(moved.residenceCountry, 'GE')
  assert.equal(moved.signupCountry, 'DE')
  assert.deepEqual(auditLog.at(-1)?.details, { from: 'DE', to: 'GE', ticket: 'T-42' })
})

test('ru contour blocks registration from non-RU IP, login stays open (business trip)', async () => {
  const app = makeApp({ contour: 'ru', ipCountry: { '5.1.1.1': 'NL', '95.1.1.1': 'RU' } })

  const geo = await (await app.request('/api/geo', { headers: { 'x-forwarded-for': '5.1.1.1' } })).json()
  assert.deepEqual(geo, { country: 'NL', contour: 'ru', allowed: false, providers: ['yandex'] })

  const denied = await app.request('/api/auth/register', json(reg, '5.1.1.1'))
  assert.equal(denied.status, 403)
  assert.equal((await denied.json()).error, 'ContourRestricted')

  const ok = await app.request('/api/auth/register', json(reg, '95.1.1.1'))
  assert.equal(ok.status, 201)

  const abroadLogin = await app.request('/api/auth/login', json({ identifier: 'alina.indie.media', password: reg.password }, '5.1.1.1'))
  assert.equal(abroadLogin.status, 200)
  assert.equal((await abroadLogin.json()).user.signupCountry, 'RU')

  const ruLogin = await app.request('/api/auth/login', json({ identifier: 'alina.indie.media', password: reg.password }, '95.1.1.1'))
  assert.equal(ruLogin.status, 200)
})

test('ru contour treats unknown country as denied', async () => {
  const app = makeApp({ contour: 'ru' })
  const res = await app.request('/api/auth/register', json(reg, '203.0.113.9'))
  assert.equal(res.status, 403)
})

test('duplicate handle -> 409, wrong password -> 401, bad body -> 400', async () => {
  const app = makeApp()
  await app.request('/api/auth/register', json(reg, '1.1.1.1'))
  assert.equal((await app.request('/api/auth/register', json(reg, '1.1.1.1'))).status, 409)
  assert.equal(
    (await app.request('/api/auth/login', json({ identifier: 'alina.indie.media', password: 'nope' }, '1.1.1.1'))).status,
    401,
  )
  assert.equal((await app.request('/api/auth/register', json({ ...reg, username: 'a' }, '1.1.1.1'))).status, 400)
})

test('/me with bearer token; admin sets premium tier', async () => {
  const app = makeApp()
  const { accessJwt, user } = await (await app.request('/api/auth/register', json(reg, '1.1.1.1'))).json()

  const me = await app.request('/api/me', { headers: { authorization: `Bearer ${accessJwt}` } })
  assert.equal((await me.json()).did, user.did)

  const put = (token: string) =>
    app.request(`/api/admin/users/${user.did}/tier`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ tier: 'premium' }),
    })
  assert.equal((await put('wrong-token-000000000')).status, 401)
  const res = await put('admin-token-0123456789')
  const body = await res.json()
  assert.equal(body.tier, 'premium')
  assert.ok(body.premiumSince)
})

const prefs = {
  font: 'serif',
  appearance: 'dark',
  accent: 'forest',
  uiLang: 'ru',
  feedSort: 'hot',
  showCondemned: false,
  hideTicker: true,
}

test('settings: auth required, section merge, validation', async () => {
  const app = makeApp()
  const { accessJwt } = await (await app.request('/api/auth/register', json(reg, '1.1.1.1'))).json()
  const auth = { authorization: `Bearer ${accessJwt}`, 'content-type': 'application/json' }
  const patch = (body: unknown) => app.request('/api/me/settings', { method: 'PATCH', headers: auth, body: JSON.stringify(body) })

  assert.equal((await app.request('/api/me/settings')).status, 401)
  assert.equal((await app.request('/api/me/settings', { headers: { authorization: 'Bearer acc-did:plc:nobody' } })).status, 401)

  const empty = await (await app.request('/api/me/settings', { headers: auth })).json()
  assert.deepEqual(empty, { data: {}, updatedAt: null })

  assert.equal((await patch({ prefs, juryOptOut: true })).status, 200)
  const tiers = [{ id: 't1', name: 'Патрон', priceMonthly: 999, description: '' }]
  const merged = await (await patch({ tiers })).json()
  assert.deepEqual(merged.data, { prefs, juryOptOut: true, tiers })

  assert.equal((await patch({ prefs: { ...prefs, font: 'comic' } })).status, 400)
  assert.equal((await patch({ unknownSection: 1 })).status, 400)
  assert.equal((await patch({ tiers: [{ ...tiers[0], priceMonthly: -1 }] })).status, 400)

  // «продолжить с места» и история прочтений — приватные разделы с ограниченным размером
  const videoProgress = { 'a1:v0': { t: 83, d: 600, at: 1 } }
  const readHistory = [{ id: 'a1', title: 'Статья', kind: 'video', at: 1 }]
  assert.equal((await patch({ videoProgress, readHistory })).status, 200)
  assert.deepEqual((await (await app.request('/api/me/settings', { headers: auth })).json()).data.videoProgress, videoProgress)
  assert.equal((await patch({ videoProgress: { k: { t: -1, at: 1 } } })).status, 400)
  const many = Object.fromEntries(Array.from({ length: 201 }, (_, i) => [`k${i}`, { t: 10, at: 1 }]))
  assert.equal((await patch({ videoProgress: many })).status, 400, 'не больше 200 роликов')
  assert.equal((await patch({ readHistory: Array.from({ length: 201 }, () => readHistory[0]) })).status, 400)
})

/** проходит /start и /callback как браузер, возвращает Location callback-а */
async function yandexFlow(app: ReturnType<typeof makeApp>, code: string, ip: string, stateOverride?: string) {
  return oauthFlow(app, 'yandex', code, ip, { stateOverride })
}

async function oauthFlow(
  app: ReturnType<typeof makeApp>,
  provider: OAuthProviderId,
  code: string,
  ip: string,
  opts: { stateOverride?: string; linkToken?: string; consent?: boolean } = {},
) {
  let authorize: string
  let cookie: string
  if (opts.linkToken) {
    const res = await app.request(`/api/me/identities/${provider}/link`, {
      method: 'POST',
      headers: { authorization: `Bearer ${opts.linkToken}`, 'content-type': 'application/json' },
      body: '{}',
    })
    assert.equal(res.status, 200, await res.clone().text())
    authorize = (await res.json()).url
    cookie = res.headers.get('set-cookie')!.split(';')[0]!
  } else {
    const start = await app.request(`/api/auth/${provider}/start?returnTo=/compose${opts.consent === false ? '' : '&consent=1'}`)
    assert.equal(start.status, 302)
    authorize = start.headers.get('location')!
    cookie = start.headers.get('set-cookie')!.split(';')[0]!
  }
  const state = new URL(authorize).searchParams.get('state')!
  const cb = await app.request(`/api/auth/${provider}/callback?code=${code}&state=${opts.stateOverride ?? state}`, {
    headers: { cookie, 'x-forwarded-for': ip },
  })
  assert.equal(cb.status, 302)
  return new URL(cb.headers.get('location')!)
}

async function atprotoFlow(app: ReturnType<typeof makeApp>, handle: string, ip: string, consent = true) {
  const start = await app.request(`/api/auth/atproto/start?handle=${handle}&returnTo=/feed${consent ? '&consent=1' : ''}`)
  assert.equal(start.status, 302)
  const authorize = new URL(start.headers.get('location')!)
  const cookie = start.headers.get('set-cookie')!.split(';')[0]!
  const cb = await app.request(`/api/auth/atproto/callback?${new URLSearchParams({ handle, state: authorize.searchParams.get('state')! })}`, {
    headers: { cookie, 'x-forwarded-for': ip },
  })
  assert.equal(cb.status, 302)
  return new URL(cb.headers.get('location')!)
}

test('atproto: first login creates linked account in global contour; RU and no-consent refused', async () => {
  const app = makeApp({ atproto: true, ipCountry: { '5.1.1.1': 'DE', '95.1.1.1': 'RU' } })
  const noConsent = await atprotoFlow(app, 'perfscale.su', '5.1.1.1', false)
  assert.equal(noConsent.searchParams.get('error'), 'ConsentRequired')
  const fromRu = await atprotoFlow(app, 'perfscale.su', '95.1.1.1')
  assert.equal(fromRu.searchParams.get('error'), 'NotLinked')
  const noEmail = await atprotoFlow(app, 'noemail.ext', '5.1.1.1')
  assert.equal(noEmail.searchParams.get('error'), 'EmailRequired')

  const first = await atprotoFlow(app, 'perfscale.su', '5.1.1.1')
  const s = await (await app.request('/api/auth/handoff', json({ code: first.searchParams.get('handoff') }, '5.1.1.1'))).json()
  assert.equal(s.user.handle, 'perfscale-su.indie.media')
  assert.equal(s.user.signupCountry, 'DE')
  // повторный вход — в тот же аккаунт, уже без согласия
  const again = await atprotoFlow(app, 'perfscale.su', '5.1.1.1', false)
  const s2 = await (await app.request('/api/auth/handoff', json({ code: again.searchParams.get('handoff') }, '5.1.1.1'))).json()
  assert.equal(s2.user.did, s.user.did)
})

test('imports: posts of linked AT account become drafts; re-import does not duplicate; publish/dismiss', async () => {
  const app = makeApp({ atproto: true, ipCountry: { '5.1.1.1': 'DE' } })
  const unlinked = await (await app.request('/api/auth/register', json(reg, '5.1.1.1'))).json()
  const notLinked = await app.request('/api/me/imports/atproto', { method: 'POST', headers: { authorization: `Bearer ${unlinked.accessJwt}` } })
  assert.equal(notLinked.status, 404)

  const login = await atprotoFlow(app, 'perfscale.su', '5.1.1.1')
  const s = await (await app.request('/api/auth/handoff', json({ code: login.searchParams.get('handoff') }, '5.1.1.1'))).json()
  const auth = { authorization: `Bearer ${s.accessJwt}`, 'content-type': 'application/json' }
  assert.equal((await app.request('/api/me/imports/atproto', { method: 'POST' })).status, 401)
  const first = await (await app.request('/api/me/imports/atproto', { method: 'POST', headers: auth })).json()
  assert.deepEqual(first, { added: 2, seen: 3, complete: true })
  const again = await (await app.request('/api/me/imports/atproto', { method: 'POST', headers: auth })).json()
  assert.equal(again.added, 0)

  const { drafts } = await (await app.request('/api/me/imports?status=pending', { headers: auth })).json()
  assert.equal(drafts.length, 2)
  assert.equal(drafts[0].title, 'Смотри сайт')
  assert.equal(drafts[0].text, '![кот](https://ext.pds/xrpc/com.atproto.sync.getBlob?did=did%3Aplc%3Aperfscalesu&cid=bafyimg)')
  assert.equal(drafts[1].title, 'Первый пост')
  assert.equal(drafts[1].text, 'второй абзац')

  const pub = await app.request(`/api/me/imports/${drafts[0].id}`, { method: 'PATCH', headers: auth, body: JSON.stringify({ status: 'published', articleUri: 'at://did:plc:x/media.weat.article/1' }) })
  assert.equal((await pub.json()).articleUri, 'at://did:plc:x/media.weat.article/1')
  await app.request(`/api/me/imports/${drafts[1].id}`, { method: 'PATCH', headers: auth, body: JSON.stringify({ status: 'dismissed' }) })
  assert.equal((await (await app.request('/api/me/imports?status=pending', { headers: auth })).json()).drafts.length, 0)
  // чужой черновик не виден
  assert.equal((await app.request(`/api/me/imports/${drafts[0].id}`, { headers: { authorization: `Bearer ${unlinked.accessJwt}` } })).status, 404)
})

test('admin mail: support sees support@ only, admin sees all; read/reply audited; noreply send refused', async () => {
  const app = makeApp()
  mailSent = []
  const support = { authorization: `Bearer ${await staffToken(['support'])}`, 'content-type': 'application/json' }
  const admin = { authorization: `Bearer ${await staffToken(['admin'])}`, 'content-type': 'application/json' }
  assert.equal((await app.request('/api/admin/mail/boxes')).status, 401)
  assert.deepEqual((await (await app.request('/api/admin/mail/boxes', { headers: support })).json()).boxes, ['support'])
  assert.deepEqual((await (await app.request('/api/admin/mail/boxes', { headers: admin })).json()).boxes, ['support', 'legal', 'noreply'])

  assert.equal((await app.request('/api/admin/mail/legal/messages', { headers: support })).status, 403, 'legal@ — только admin')
  assert.equal((await app.request('/api/admin/mail/other/messages', { headers: admin })).status, 404)
  const list = await (await app.request('/api/admin/mail/support/messages', { headers: support })).json()
  assert.equal(list.messages[0].subject, 'Вопрос в support')
  const msg = await (await app.request('/api/admin/mail/support/messages/1', { headers: support })).json()
  assert.equal(msg.text, 'Здравствуйте')
  assert.equal((await app.request('/api/admin/mail/support/messages/9', { headers: support })).status, 404)

  const att = await app.request('/api/admin/mail/support/messages/1/attachments/0', { headers: support })
  assert.equal(att.headers.get('content-type'), 'application/octet-stream')
  assert.match(att.headers.get('content-disposition')!, /^attachment; filename\*=UTF-8''/)

  const reply = await app.request('/api/admin/mail/support/send', { method: 'POST', headers: support, body: JSON.stringify({ to: 'reader@example.com', subject: 'Re: Вопрос', text: 'Ответ', replyToUid: 1 }) })
  assert.equal(reply.status, 201)
  assert.deepEqual(mailSent, [{ box: 'support', to: 'reader@example.com', subject: 'Re: Вопрос', inReplyTo: '<m1-support@example.com>' }])
  assert.equal((await app.request('/api/admin/mail/support/send', { method: 'POST', headers: support, body: JSON.stringify({ to: 'bad', subject: 'x', text: 'y' }) })).status, 400)
  assert.equal((await app.request('/api/admin/mail/noreply/send', { method: 'POST', headers: admin, body: JSON.stringify({ to: 'a@b.co', subject: 'x', text: 'y' }) })).status, 400)
  const actions = auditLog.map((e) => e.action)
  assert.ok(actions.includes('mail.read') && actions.includes('mail.reply') && actions.includes('mail.attachment'))
})

test('payouts: balance from paid sales with hold, request reserves all available, admin decides', async () => {
  const app = makeApp({ ipCountry: { '5.1.1.1': 'DE' } })
  const u = await (await app.request('/api/auth/register', json({ ...reg, username: 'writer', email: 'writer@example.com' }, '5.1.1.1'))).json()
  const auth = { authorization: `Bearer ${u.accessJwt}`, 'content-type': 'application/json' }
  const old = new Date(Date.now() - 30 * 86_400_000)
  paidSales = [
    { author: u.user.did, share: 90_000, currency: 'RUB', paidAt: old, title: 'Старая' },
    { author: u.user.did, share: 45_000, currency: 'RUB', paidAt: new Date(), title: 'Свежая' },
    { author: 'did:plc:other', share: 999_999, currency: 'RUB', paidAt: old, title: 'Чужая' },
  ]
  assert.equal((await app.request('/api/me/earnings')).status, 401)
  const e = await (await app.request('/api/me/earnings', { headers: auth })).json()
  assert.deepEqual(e.balances, [{ currency: 'RUB', earned: 135_000, pending: 45_000, reserved: 0, paidOut: 0, available: 90_000, minPayout: 100_000 }])
  assert.equal(e.sales.length, 2)

  const ask = (b: unknown) => app.request('/api/me/payouts', { method: 'POST', headers: auth, body: JSON.stringify(b) })
  assert.equal((await ask({ currency: 'RUB', method: 'fiat', destination: '4242 4242 4242 4242' })).status, 409, 'меньше минимума 1000 ₽')
  paidSales.push({ author: u.user.did, share: 20_000, currency: 'RUB', paidAt: old, title: 'Ещё' })
  assert.equal((await ask({ currency: 'RUB', method: 'fiat', destination: 'short' })).status, 400)
  const po = await (await ask({ currency: 'RUB', method: 'fiat', destination: '4242 4242 4242 4242' })).json()
  assert.equal(po.amount, 110_000)
  assert.equal(po.destinationHint, '•••• 4242')
  assert.equal(po.destination, undefined, 'автору реквизиты целиком не возвращаем')
  const after = await (await app.request('/api/me/earnings', { headers: auth })).json()
  assert.equal(after.balances[0].available, 0)
  assert.equal(after.balances[0].reserved, 110_000)

  const support = { authorization: `Bearer ${await staffToken(['support'])}`, 'content-type': 'application/json' }
  const admin = { authorization: `Bearer ${await staffToken(['admin'])}`, 'content-type': 'application/json' }
  assert.equal((await app.request('/api/admin/payouts', { headers: support })).status, 403)
  const q = await (await app.request('/api/admin/payouts?status=requested', { headers: admin })).json()
  assert.equal(q[0].destination, '4242 4242 4242 4242')
  const decide = (b: unknown) => app.request(`/api/admin/payouts/${po.id}`, { method: 'PATCH', headers: admin, body: JSON.stringify(b) })
  assert.equal((await decide({ status: 'rejected' })).status, 400, 'отказ — с причиной')
  assert.equal((await (await decide({ status: 'rejected', note: 'Неверная карта' })).json()).status, 'rejected')
  assert.equal((await decide({ status: 'paid' })).status, 404, 'рассмотренную не меняем')
  const back = await (await app.request('/api/me/earnings', { headers: auth })).json()
  assert.equal(back.balances[0].available, 110_000, 'отклонённая сумма снова доступна')
  assert.equal(back.payouts[0].staffNote, 'Неверная карта')
})

test('admin: 5 bad staff tokens in a row ban the IP; other IPs and anonymous page views are unaffected', async () => {
  const app = makeApp()
  const hit = (ip: string, token?: string) =>
    app.request('/api/admin/me', { headers: { 'x-forwarded-for': ip, ...(token ? { authorization: `Bearer ${token}` } : {}) } })
  for (let i = 0; i < 10; i++) assert.equal((await hit('7.7.7.7')).status, 401, 'без токена — не попытка')
  for (let i = 0; i < 4; i++) assert.equal((await hit('7.7.7.7', 'forged')).status, 401)
  const good = await staffToken(['support'])
  assert.equal((await hit('7.7.7.7', good)).status, 200, 'успешный вход сбрасывает счётчик')
  for (let i = 0; i < 5; i++) assert.equal((await hit('7.7.7.7', 'forged')).status, 401)
  const banned = await hit('7.7.7.7', good)
  assert.equal(banned.status, 429, 'IP забанен даже с верным токеном')
  assert.ok(Number(banned.headers.get('retry-after')) > 800)
  assert.equal((await hit('8.8.8.8', good)).status, 200, 'другой IP работает')
  assert.ok(auditLog.some((e) => e.action === 'staff.ip_banned' && e.target === '7.7.7.7'))
})

test('atproto: ru contour never registers', async () => {
  const app = makeApp({ atproto: true, contour: 'ru', ipCountry: { '95.1.1.1': 'RU' } })
  const start = await app.request('/api/auth/atproto/start?handle=perfscale.su&consent=1')
  assert.equal(new URL(start.headers.get('location')!).searchParams.get('error'), 'ProviderForbidden')
})

test('yandex: register, then login from abroad; handoff code is single-use', async () => {
  const app = makeApp({ contour: 'ru', ipCountry: { '95.1.1.1': 'RU', '5.1.1.1': 'NL' } })
  const geo = await (await app.request('/api/geo', { headers: { 'x-forwarded-for': '95.1.1.1' } })).json()
  assert.deepEqual(geo.providers, ['yandex'])

  const reg = await yandexFlow(app, 'code-ivan', '95.1.1.1')
  assert.equal(reg.searchParams.get('returnTo'), '/compose')
  const code = reg.searchParams.get('handoff')!
  const ex = (c: string) => app.request('/api/auth/handoff', json({ code: c }, '95.1.1.1'))
  const first = await (await ex(code)).json()
  assert.equal(first.user.handle, 'ivan-petrov.indie.media')
  assert.equal(first.user.displayName, 'Иван Петров')
  assert.equal(first.user.signupCountry, 'RU')
  assert.equal((await ex(code)).status, 400)

  const abroad = await yandexFlow(app, 'code-ivan', '5.1.1.1')
  const again = await (await ex(abroad.searchParams.get('handoff')!)).json()
  assert.equal(again.user.did, first.user.did)
})

test('yandex: new account from non-RU IP in ru contour is refused; bad state refused', async () => {
  const app = makeApp({ contour: 'ru', ipCountry: { '5.1.1.1': 'NL', '95.1.1.1': 'RU' } })
  const r = await yandexFlow(app, 'code-ivan', '5.1.1.1')
  assert.equal(r.searchParams.get('error'), 'ContourRestricted')
  const bad = await yandexFlow(app, 'code-ivan', '95.1.1.1', 'forged')
  assert.equal(bad.searchParams.get('error'), 'InvalidState')
  const noEmail = await yandexFlow(app, 'code-noemail', '95.1.1.1')
  assert.equal(noEmail.searchParams.get('error'), 'EmailRequired')
})

test('yandex: username collision gets suffix', async () => {
  const app = makeApp()
  await app.request('/api/auth/register', json({ ...reg, username: 'ivan-petrov', email: 'x@x.io' }, '1.1.1.1'))
  const r = await yandexFlow(app, 'code-ivan', '1.1.1.1')
  const s = await (await app.request('/api/auth/handoff', json({ code: r.searchParams.get('handoff') }, '1.1.1.1'))).json()
  assert.equal(s.user.handle, 'ivan-petrov-2.indie.media')
})

test('secretbox roundtrip and tamper detection', () => {
  const box = createSecretBox('22'.repeat(32))
  const sealed = box.seal('pds-password')
  assert.equal(box.open(sealed), 'pds-password')
  const parts = sealed.split('.')
  parts[3] = Buffer.from('tampered').toString('base64url')
  assert.throws(() => box.open(parts.join('.')))
})

async function registerWithPassword(app: ReturnType<typeof makeApp>, ip: string, username = 'alina') {
  const res = await app.request('/api/auth/register', json({ username, email: `${username}@example.com`, password: 'correct-horse', consent: reg.consent }, ip))
  return (await res.json()) as { accessJwt: string; user: { did: string } }
}

const getIds = async (app: ReturnType<typeof makeApp>, token: string) =>
  (await app.request('/api/me/identities', { headers: { authorization: `Bearer ${token}` } })).json()

test('link google + github to password account, then log in with them', async () => {
  const app = makeApp({ ipCountry: { '5.1.1.1': 'DE' } })
  const { accessJwt, user } = await registerWithPassword(app, '5.1.1.1')

  const g = await oauthFlow(app, 'google', 'code-g', '5.1.1.1', { linkToken: accessJwt })
  assert.equal(g.pathname, '/profile/alina.indie.media/settings/accounts')
  assert.equal(g.searchParams.get('linked'), 'google')
  await oauthFlow(app, 'github', 'code-gh', '5.1.1.1', { linkToken: accessJwt })

  const ids = await getIds(app, accessJwt)
  const byP = Object.fromEntries(ids.providers.map((p: { provider: string }) => [p.provider, p]))
  assert.equal(byP.google.linked.display, 'alina@gmail.com')
  assert.equal(byP.github.linked.display, '@alina-dev')
  assert.equal(byP.telegram.linked, null)

  const login = await oauthFlow(app, 'google', 'code-g', '5.1.1.1')
  const s = await (await app.request('/api/auth/handoff', json({ code: login.searchParams.get('handoff') }, '5.1.1.1'))).json()
  assert.equal(s.user.did, user.did)
})

test('RU account can link foreign providers in settings but cannot log in with them', async () => {
  const app = makeApp({ ipCountry: { '95.1.1.1': 'RU' } })
  const { accessJwt } = await registerWithPassword(app, '95.1.1.1')

  const g = await oauthFlow(app, 'google', 'code-g', '95.1.1.1', { linkToken: accessJwt })
  assert.equal(g.searchParams.get('linked'), 'google')
  const tg = await oauthFlow(app, 'telegram', 'code-tg', '95.1.1.1', { linkToken: accessJwt })
  assert.equal(tg.searchParams.get('linked'), 'telegram')

  const ids = await getIds(app, accessJwt)
  const google = ids.providers.find((p: { provider: string }) => p.provider === 'google')
  assert.equal(google.linked.display, 'alina@gmail.com')
  assert.equal(google.loginAllowed, false)
  assert.equal(ids.providers.find((p: { provider: string }) => p.provider === 'yandex').loginAllowed, true)

  // вход через привязанный иностранный сервис закрыт
  const login = await oauthFlow(app, 'google', 'code-g', '95.1.1.1')
  assert.equal(login.searchParams.get('error'), 'ProviderForbidden')
  const tgLogin = await oauthFlow(app, 'telegram', 'code-tg', '95.1.1.1')
  assert.equal(tgLogin.searchParams.get('error'), 'ProviderForbidden')
})

test('ru contour hides foreign providers on login page and refuses foreign start', async () => {
  const app = makeApp({ contour: 'ru', ipCountry: { '5.1.1.1': 'DE' } })
  const geo = await (await app.request('/api/geo', { headers: { 'x-forwarded-for': '5.1.1.1' } })).json()
  assert.deepEqual(geo.providers, ['yandex'])
  assert.equal((await app.request('/api/auth/google/start')).status, 403)
  const global = await (await makeApp().request('/api/geo')).json()
  assert.deepEqual(global.providers, ['yandex', 'google', 'github', 'telegram'])
})

test('telegram client: authorize URL carries S256 challenge of the verifier, openid profile scope', () => {
  const tg = createOAuthClient('telegram', { clientId: '9113397681', clientSecret: 's' })
  assert.equal(tg.pkce, true)
  const u = new URL(tg.authorizeUrl('st', 'https://weat.media/api/auth/telegram/callback', 'v'.repeat(43)))
  assert.equal(u.origin + u.pathname, 'https://oauth.telegram.org/auth')
  assert.equal(u.searchParams.get('code_challenge_method'), 'S256')
  assert.equal(u.searchParams.get('code_challenge'), createHash('sha256').update('v'.repeat(43)).digest('base64url'))
  assert.equal(u.searchParams.get('scope'), 'openid profile')
  assert.equal(u.searchParams.get('client_id'), '9113397681')
})

test('telegram (OIDC + PKCE): link, then log in; verifier reaches token exchange; no account creation', async () => {
  const app = makeApp({ ipCountry: { '5.1.1.1': 'DE' } })
  const unknown = await oauthFlow(app, 'telegram', 'code-tg', '5.1.1.1')
  assert.equal(unknown.searchParams.get('error'), 'NotLinked', 'Telegram не даёт email — аккаунт через него не создаётся')
  const { accessJwt, user } = await registerWithPassword(app, '5.1.1.1')
  const link = await oauthFlow(app, 'telegram', 'code-tg', '5.1.1.1', { linkToken: accessJwt })
  assert.equal(link.searchParams.get('linked'), 'telegram')
  const login = await oauthFlow(app, 'telegram', 'code-tg', '5.1.1.1')
  const s = await (await app.request('/api/auth/handoff', json({ code: login.searchParams.get('handoff') }, '5.1.1.1'))).json()
  assert.equal(s.user.did, user.did)
  assert.ok(pkceSeen.length >= 3 && pkceSeen.every((v) => typeof v === 'string' && v.length >= 43))
  assert.equal(new Set(pkceSeen).size, pkceSeen.length, 'verifier новый на каждый вход')
})

test('identity in use, unlink revokes app password, last/primary method guarded', async () => {
  const app = makeApp({ ipCountry: { '5.1.1.1': 'DE', '95.1.1.1': 'RU' } })
  const a = await registerWithPassword(app, '5.1.1.1', 'alina')
  const b = await registerWithPassword(app, '5.1.1.1', 'boris')
  await oauthFlow(app, 'google', 'code-g', '5.1.1.1', { linkToken: a.accessJwt })
  const taken = await oauthFlow(app, 'google', 'code-g', '5.1.1.1', { linkToken: b.accessJwt })
  assert.equal(taken.searchParams.get('error'), 'IdentityInUse')

  const del = await app.request('/api/me/identities/google', { method: 'DELETE', headers: { authorization: `Bearer ${a.accessJwt}` } })
  assert.equal(del.status, 200)
  const relogin = await oauthFlow(app, 'google', 'code-g', '5.1.1.1')
  assert.equal(relogin.searchParams.get('error'), 'NotLinked')

  // Яндекс-регистрация: пароля нет, Яндекс — основной способ
  const ya = await oauthFlow(app, 'yandex', 'code-ivan', '95.1.1.1')
  const s = await (await app.request('/api/auth/handoff', json({ code: ya.searchParams.get('handoff') }, '95.1.1.1'))).json()
  const auth = { authorization: `Bearer ${s.accessJwt}` }
  const last = await app.request('/api/me/identities/yandex', { method: 'DELETE', headers: auth })
  assert.equal((await last.json()).error, 'LastLoginMethod')
  const ids = await getIds(app, s.accessJwt)
  assert.equal(ids.passwordLogin, false)
  assert.equal(ids.providers.find((p: { provider: string }) => p.provider === 'yandex').linked.primary, true)
})

test('app-password session cannot create new links', async () => {
  const app = makeApp({ ipCountry: { '5.1.1.1': 'DE' } })
  const { accessJwt } = await registerWithPassword(app, '5.1.1.1')
  await oauthFlow(app, 'google', 'code-g', '5.1.1.1', { linkToken: accessJwt })
  const viaGoogle = await oauthFlow(app, 'google', 'code-g', '5.1.1.1')
  const s = await (await app.request('/api/auth/handoff', json({ code: viaGoogle.searchParams.get('handoff') }, '5.1.1.1'))).json()
  const gh = await oauthFlow(app, 'github', 'code-gh', '5.1.1.1', { linkToken: s.accessJwt })
  assert.equal(gh.searchParams.get('error'), 'FullSessionRequired')
})


test('email confirmation turns on email 2FA by default; login then needs the emailed code', async () => {
  const app = makeApp()
  const { accessJwt } = await registerWithPassword(app, '1.1.1.1')
  const auth = { authorization: `Bearer ${accessJwt}`, 'content-type': 'application/json' }
  const sec0 = await (await app.request('/api/me/security', { headers: auth })).json()
  assert.deepEqual([sec0.emailConfirmed, sec0.emailAuthFactor], [false, false])
  assert.equal(mailbox.confirm, 'CONF-1', 'код подтверждения отправлен при регистрации')

  const bad = await app.request('/api/me/email/confirm', { method: 'POST', headers: auth, body: JSON.stringify({ code: 'WRONG-1' }) })
  assert.equal(bad.status, 400)
  const sec = await (await app.request('/api/me/email/confirm', { method: 'POST', headers: auth, body: JSON.stringify({ code: 'CONF-1' }) })).json()
  assert.deepEqual([sec.emailConfirmed, sec.emailAuthFactor], [true, true])

  const creds = { identifier: 'alina.indie.media', password: 'correct-horse' }
  const step1 = await app.request('/api/auth/login', json(creds, '1.1.1.1'))
  assert.equal(step1.status, 401)
  assert.equal((await step1.json()).error, 'AuthFactorTokenRequired')
  const wrong = await app.request('/api/auth/login', json({ ...creds, authFactorToken: 'NOPE-1' }, '1.1.1.1'))
  assert.equal((await wrong.json()).error, 'InvalidCode')
  const ok = await app.request('/api/auth/login', json({ ...creds, authFactorToken: 'TWOFA-1' }, '1.1.1.1'))
  assert.equal(ok.status, 200)

  // выключение — только с кодом из письма
  const off1 = await (await app.request('/api/me/2fa/email', { method: 'POST', headers: auth, body: JSON.stringify({ enabled: false }) })).json()
  assert.equal(off1.codeSent, true)
  const off2 = await (await app.request('/api/me/2fa/email', { method: 'POST', headers: auth, body: JSON.stringify({ enabled: false, code: 'UPD-123' }) })).json()
  assert.equal(off2.emailAuthFactor, false)
})

test('TOTP: setup, enable, every login path gated, backup code single-use, brute-force limit', async () => {
  const app = makeApp({ ipCountry: { '5.1.1.1': 'DE' } })
  const { accessJwt } = await registerWithPassword(app, '5.1.1.1')
  const auth = { authorization: `Bearer ${accessJwt}`, 'content-type': 'application/json' }
  const post = (path: string, b: unknown) => app.request(path, { method: 'POST', headers: auth, body: JSON.stringify(b) })

  const { secret, otpauthUrl } = await (await post('/api/me/2fa/totp/setup', {})).json()
  assert.match(otpauthUrl, /^otpauth:\/\/totp\/Indie\.media/)
  const now = () => totpCode(secret, Math.floor(Date.now() / 30_000))
  assert.equal((await post('/api/me/2fa/totp/enable', { code: '000000' === now() ? '111111' : '000000' })).status, 400)
  const en = await (await post('/api/me/2fa/totp/enable', { code: now() })).json()
  assert.equal(en.backupCodes.length, 10)
  assert.equal(en.security.totpEnabled, true)

  const creds = { identifier: 'alina.indie.media', password: 'correct-horse' }
  const gated = await (await app.request('/api/auth/login', json(creds, '5.1.1.1'))).json()
  assert.equal(gated.mfaRequired, 'totp')
  assert.equal(gated.accessJwt, undefined, 'токены не выдаются до второго фактора')

  const mfa = (code: string, token = gated.mfaToken) => app.request('/api/auth/mfa', json({ mfaToken: token, code }, '5.1.1.1'))
  // код, которым включали TOTP, второй раз не принимается (повтор); следующий шаг — да
  assert.equal((await mfa(now())).status, 401, 'повтор кода')
  const next = totpCode(secret, Math.floor(Date.now() / 30_000) + 1)
  const passed = await (await mfa(next)).json()
  assert.equal(passed.user.handle, 'alina.indie.media')
  assert.equal((await mfa(next)).status, 401, 'mfaToken одноразовый')

  // обход: токен, полученный прямо в PDS без TOTP, AppView не принимает; прошедший — принимает
  const direct = await fakePdsLast!.createSession('alina.indie.media', 'correct-horse')
  const me = (t: string) => app.request('/api/me', { headers: { authorization: `Bearer ${t}` } })
  assert.equal((await me(direct.accessJwt)).status, 401)
  assert.equal((await (await me(direct.accessJwt)).json()).error, 'MfaRequired')
  assert.equal((await me(passed.accessJwt)).status, 200)
  const refreshDirect = await app.request('/api/auth/refresh', json({ refreshJwt: direct.refreshJwt }, '5.1.1.1'))
  assert.equal(refreshDirect.status, 401, 'refresh из прямого входа')
  const refreshed = await (await app.request('/api/auth/refresh', json({ refreshJwt: passed.refreshJwt }, '5.1.1.1'))).json()
  assert.equal((await me(refreshed.accessJwt)).status, 200, 'отметка переходит на новую пару')
  assert.equal((await app.request('/api/me/tokens', { method: 'POST', headers: { authorization: `Bearer ${direct.accessJwt}`, 'content-type': 'application/json' }, body: JSON.stringify({ name: 'x', scopes: ['articles:write'] }) })).status, 401, 'PAT обходом не выпустить')

  // привязанный Google тоже требует TOTP
  await oauthFlow(app, 'google', 'code-g', '5.1.1.1', { linkToken: passed.accessJwt })
  const g = await oauthFlow(app, 'google', 'code-g', '5.1.1.1')
  const viaGoogle = await (await app.request('/api/auth/handoff', json({ code: g.searchParams.get('handoff') }, '5.1.1.1'))).json()
  assert.equal(viaGoogle.mfaRequired, 'totp')

  const backup = en.backupCodes[0]
  assert.equal((await mfa(backup, viaGoogle.mfaToken)).status, 200)
  const again = await (await app.request('/api/auth/login', json(creds, '5.1.1.1'))).json()
  assert.equal((await mfa(backup, again.mfaToken)).status, 401, 'резервный код одноразовый')

  // перебор: 10 неверных кодов — блокировка аккаунта, новый mfaToken не помогает
  for (let i = 0; i < 9; i++) await mfa('999999', again.mfaToken)
  const fresh = await (await app.request('/api/auth/login', json(creds, '5.1.1.1'))).json()
  await mfa('999999', fresh.mfaToken)
  const locked = await mfa(totpCode(secret, Math.floor(Date.now() / 30_000) + 1), fresh.mfaToken)
  assert.equal(locked.status, 429)
  assert.equal((await locked.json()).error, 'TooManyAttempts')
})

test('password reset: same answer for unknown email; Yandex user adopts password, Yandex login keeps working', async () => {
  const app = makeApp({ ipCountry: { '95.1.1.1': 'RU' } })
  const unknown = await app.request('/api/auth/password/forgot', json({ email: 'nobody@example.com' }, '95.1.1.1'))
  assert.equal(unknown.status, 200)

  const ya = await oauthFlow(app, 'yandex', 'code-ivan', '95.1.1.1')
  await app.request('/api/auth/handoff', json({ code: ya.searchParams.get('handoff') }, '95.1.1.1'))

  assert.equal((await app.request('/api/auth/password/forgot', json({ email: 'ivan@yandex.ru' }, '95.1.1.1'))).status, 200)
  const badReset = await app.request('/api/auth/password/reset', json({ token: 'RESET-wrong', password: 'new-password-1' }, '95.1.1.1'))
  assert.equal((await badReset.json()).error, 'InvalidResetToken')
  const reset = await app.request('/api/auth/password/reset', json({ token: mailbox.reset, password: 'new-password-1' }, '95.1.1.1'))
  assert.equal(reset.status, 200)

  const login = await (await app.request('/api/auth/login', json({ identifier: 'ivan-petrov.indie.media', password: 'new-password-1' }, '95.1.1.1'))).json()
  const ids = await getIds(app, login.accessJwt)
  assert.equal(ids.passwordLogin, true)

  // старый основной пароль в привязке заменён app password — вход через Яндекс жив
  const again = await oauthFlow(app, 'yandex', 'code-ivan', '95.1.1.1')
  const s = await (await app.request('/api/auth/handoff', json({ code: again.searchParams.get('handoff') }, '95.1.1.1'))).json()
  assert.equal(s.user.handle, 'ivan-petrov.indie.media')
})

test('blockDefs: Premium only, validated', async () => {
  const app = makeApp()
  const { accessJwt, user } = await registerWithPassword(app, '1.1.1.1')
  const auth = { authorization: `Bearer ${accessJwt}`, 'content-type': 'application/json' }
  const def = {
    id: 'ub_abcd1234', name: 'Заметка', icon: '💡', description: '', mode: 'visual', fields: [{ key: 'text', label: 'Текст', type: 'textarea' }],
    preset: 'callout', accent: '#3b82f6', background: '#ffffff', template: '', css: '', height: 160, updatedAt: '2026-11-12T00:00:00Z',
  }
  const patch = (blockDefs: unknown) => app.request('/api/me/settings', { method: 'PATCH', headers: auth, body: JSON.stringify({ blockDefs }) })
  assert.equal((await patch([])).status, 200, 'пустой список разрешён всем')
  const free = await patch([def])
  assert.equal(free.status, 403)
  assert.equal((await free.json()).error, 'PremiumRequired')

  await app.request(`/api/admin/users/${user.did}/tier`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', authorization: 'Bearer admin-token-0123456789' },
    body: JSON.stringify({ tier: 'premium' }),
  })
  assert.equal((await patch([def])).status, 200)
  assert.equal((await patch([{ ...def, accent: 'red;background:url(x)' }])).status, 400)
  assert.equal((await patch([{ ...def, template: 'x'.repeat(10_001) }])).status, 400)
})

test('payoutDetails: synced section with validated format', async () => {
  const app = makeApp()
  const { accessJwt } = await registerWithPassword(app, '1.1.1.1')
  const auth = { authorization: `Bearer ${accessJwt}`, 'content-type': 'application/json' }
  const patch = (payoutDetails: unknown) => app.request('/api/me/settings', { method: 'PATCH', headers: auth, body: JSON.stringify({ payoutDetails }) })
  const ok = { country: 'other', method: 'crypto', asset: 'USDT', network: 'TRC20', cryptoAddress: 'TXyz123abc' }
  assert.equal((await patch(ok)).status, 200)
  assert.equal((await patch({ ...ok, country: 'KZ', method: 'fiat', cryptoAddress: '' })).status, 200)
  assert.equal((await patch({ ...ok, cryptoAddress: '<script>' })).status, 400)
  assert.equal((await patch({ ...ok, method: 'cash' })).status, 400)
})

test('prefs accept fields added later by the frontend, within size limit', async () => {
  const app = makeApp()
  const { accessJwt } = await registerWithPassword(app, '1.1.1.1')
  const auth = { authorization: `Bearer ${accessJwt}`, 'content-type': 'application/json' }
  const patch = (prefs: unknown) => app.request('/api/me/settings', { method: 'PATCH', headers: auth, body: JSON.stringify({ prefs }) })
  const base = { font: 'sans', appearance: 'light', accent: 'terracotta', uiLang: 'ru', feedSort: 'hot', showCondemned: true, hideTicker: false }
  assert.equal((await patch({ ...base, feedTags: ['Rust'], someFutureToggle: true })).status, 200)
  const saved = await (await app.request('/api/me/settings', { headers: auth })).json()
  assert.equal(saved.data.prefs.someFutureToggle, true)
  assert.equal((await patch({ ...base, font: 'comic' })).status, 400, 'известные поля по-прежнему проверяются')
  assert.equal((await patch({ ...base, junk: 'x'.repeat(5000) })).status, 400)
})


/** сосед: известные ему handle; down — недоступен */
const fakePeer = (known: Record<string, string>, down = false) => ({
  publicUrl: 'https://ru.indie.media',
  calls: [] as string[],
  async resolve(handle: string) {
    this.calls.push(handle)
    if (down) throw new Error('peer down')
    return known[handle] ?? null
  },
})

test('contours: one handle namespace — resolve local, then peer; no peer ping-pong', async () => {
  const peer = fakePeer({ 'ivan.indie.media': 'did:plc:ivan' })
  const app = makeApp({ peer })
  const { user } = await registerWithPassword(app, '1.1.1.1')
  const local = await app.request('/api/handles/resolve', { headers: { host: 'alina.indie.media' } })
  assert.equal(await local.text(), user.did)
  const remote = await app.request('/api/handles/resolve?handle=ivan.indie.media')
  assert.equal(await remote.text(), 'did:plc:ivan')
  peer.calls.length = 0
  const hop = await app.request('/api/handles/resolve?handle=ivan.indie.media', { headers: { 'x-indie-peer-hop': '1' } })
  assert.equal(hop.status, 404, 'запрос соседа к соседу дальше не идёт')
  assert.equal(peer.calls.length, 0)
})

test('contours: handle taken in peer contour cannot be registered; peer down -> 503', async () => {
  const app = makeApp({ peer: fakePeer({ 'alina.indie.media': 'did:plc:other' }) })
  const res = await app.request('/api/auth/register', json(reg, '1.1.1.1'))
  assert.equal(res.status, 409)
  assert.equal((await res.json()).error, 'HandleTaken')
  const down = makeApp({ peer: fakePeer({}, true) })
  const r2 = await down.request('/api/auth/register', json(reg, '1.1.1.1'))
  assert.equal(r2.status, 503)
  assert.equal((await r2.json()).error, 'PeerUnavailable')
})

test('contours: login of an account from the other contour points to its node', async () => {
  const app = makeApp({ peer: fakePeer({ 'ivan.indie.media': 'did:plc:ivan' }) })
  const res = await app.request('/api/auth/login', json({ identifier: 'ivan.indie.media', password: 'whatever-1' }, '5.1.1.1'))
  assert.equal(res.status, 409)
  const body = await res.json()
  assert.equal(body.error, 'WrongContour')
  assert.equal(body.redirect, 'https://ru.indie.media/login')
  const unknown = await app.request('/api/auth/login', json({ identifier: 'nobody.indie.media', password: 'x' }, '5.1.1.1'))
  assert.equal(unknown.status, 401)
})

test('standby node refuses traffic except health', async () => {
  const app = makeApp({ nodeRole: 'standby' })
  assert.equal((await app.request('/api/health')).status, 200)
  assert.equal((await app.request('/api/geo')).status, 503)
  assert.equal((await app.request('/api/auth/register', json(reg, '1.1.1.1'))).status, 503)
})


test('paid article: only the cover reaches the public AT repo; body needs entitlement', async () => {
  const app = makeApp({ ipCountry: { '1.1.1.1': 'DE' } })
  const author = await registerWithPassword(app, '1.1.1.1', 'alina')
  const reader = await registerWithPassword(app, '1.1.1.1', 'boris')
  const SECRET = 'Полный платный текст: секретная методика замеров'
  const res = await app.request('/api/me/articles/paid', {
    method: 'POST',
    headers: { authorization: `Bearer ${author.accessJwt}`, 'content-type': 'application/json' },
    body: JSON.stringify({ title: 'Платная статья', teaser: 'Бесплатное начало', body: SECRET, paywall: { accessType: 'one-time', price: 49000, currency: 'RUB' } }),
  })
  assert.equal(res.status, 201)
  const { id, uri } = await res.json()
  const rec = published.find((p) => uri.endsWith(p.collection + '/r' + (published.indexOf(p) + 1)))!.record
  assert.equal(rec.text, 'Бесплатное начало')
  assert.deepEqual(rec.paywall, { accessType: 'one-time', price: 49000, currency: 'RUB' })
  assert.deepEqual(rec.privateContent, { service: 'http://localhost:3000', id })
  assert.equal(JSON.stringify(published).includes(SECRET), false, 'полный текст никогда не попадает в AT')

  const anon = await app.request(`/api/paid-content/${id}`)
  assert.equal(anon.status, 402)
  const terms = await anon.json()
  assert.equal(terms.error, 'PaymentRequired')
  assert.equal(JSON.stringify(terms).includes(SECRET), false)
  const asReader = (t: string) => app.request(`/api/paid-content/${id}`, { headers: { authorization: `Bearer ${t}` } })
  assert.equal((await asReader(reader.accessJwt)).status, 402)
  assert.equal((await (await asReader(author.accessJwt)).json()).body, SECRET, 'автор видит своё')

  const grant = (body: unknown, token = 'admin-token-0123456789') =>
    app.request('/api/admin/entitlements', { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) })
  assert.equal((await grant({ readerDid: reader.user.did, contentId: id }, 'wrong-token-000000000')).status, 401)
  assert.equal((await grant({ readerDid: reader.user.did, contentId: id })).status, 201)
  const paidRead = await asReader(reader.accessJwt)
  assert.equal((await paidRead.json()).body, SECRET)
  assert.match(paidRead.headers.get('cache-control') ?? '', /no-store/)

  const exp = await (await app.request('/api/me/paid-content/export', { headers: { authorization: `Bearer ${author.accessJwt}` } })).json()
  assert.equal(exp[0].body, SECRET)
})

test('paid article: subscription tier access, expiry, validation, author-only delete', async () => {
  const app = makeApp({ ipCountry: { '1.1.1.1': 'DE' } })
  const author = await registerWithPassword(app, '1.1.1.1', 'alina')
  const reader = await registerWithPassword(app, '1.1.1.1', 'boris')
  const auth = (t: string) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' })
  const pub = (b: unknown) => app.request('/api/me/articles/paid', { method: 'POST', headers: auth(author.accessJwt), body: JSON.stringify(b) })
  const base = { title: 'Для подписчиков', teaser: 'Тизер', body: 'Тело' }
  assert.equal((await pub({ ...base, paywall: { accessType: 'subscription', price: 0 } })).status, 400, 'подписка без tierId')
  assert.equal((await pub({ ...base, paywall: { accessType: 'one-time', price: 0 } })).status, 400, 'разовая покупка за 0')
  const { id } = await (await pub({ ...base, paywall: { accessType: 'subscription', price: 29900, tierId: 'tier-patron' } })).json()
  const grant = (body: unknown) =>
    app.request('/api/admin/entitlements', { method: 'POST', headers: auth('admin-token-0123456789'), body: JSON.stringify(body) })
  const read = () => app.request(`/api/paid-content/${id}`, { headers: auth(reader.accessJwt) })
  await grant({ readerDid: reader.user.did, authorDid: author.user.did, tierId: 'tier-basic' })
  assert.equal((await read()).status, 402, 'другой тариф')
  await grant({ readerDid: reader.user.did, authorDid: author.user.did, tierId: 'tier-patron', expiresAt: '2020-01-01T00:00:00Z' })
  assert.equal((await read()).status, 402, 'подписка истекла')
  await grant({ readerDid: reader.user.did, authorDid: author.user.did, tierId: 'tier-patron' })
  assert.equal((await read()).status, 200)
  assert.equal((await app.request(`/api/me/articles/paid/${id}`, { method: 'DELETE', headers: auth(reader.accessJwt) })).status, 404, 'чужую не удалить')
  assert.equal((await app.request(`/api/me/articles/paid/${id}`, { method: 'DELETE', headers: auth(author.accessJwt) })).status, 200)
  assert.equal((await read()).status, 404)
})

test('personal token: publish via public API, scopes, revoke kills PDS access', async () => {
  const app = makeApp()
  const author = await (await app.request('/api/auth/register', json({ ...reg, username: 'devtok', email: 'devtok@example.com' }, '1.1.1.1'))).json()
  const auth = (t: string) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' })

  const created = await app.request('/api/me/tokens', { method: 'POST', headers: auth(author.accessJwt), body: JSON.stringify({ name: 'CI', scopes: ['articles:write'] }) })
  assert.equal(created.status, 201)
  const tok = await created.json()
  assert.match(tok.token, /^wm_pat_/)
  assert.ok(tok.expiresAt, 'по умолчанию 90 дней')

  const list = await (await app.request('/api/me/tokens', { headers: auth(author.accessJwt) })).json()
  assert.equal(list.length, 1)
  assert.equal(list[0].token, undefined, 'секрет в списке не отдаётся')

  const manage = await app.request('/api/me/tokens', { headers: auth(tok.token) })
  assert.equal(manage.status, 403, 'токеном нельзя управлять токенами')

  const pub = await app.request('/api/v1/articles', { method: 'POST', headers: auth(tok.token), body: JSON.stringify({ title: 'Из CI', text: '# Привет' }) })
  assert.equal(pub.status, 201)
  const { uri } = await pub.json()
  assert.ok(uri.startsWith(`at://${author.user.did}/media.weat.article/`))
  assert.equal(published.at(-1)!.record.title, 'Из CI')

  assert.equal((await app.request('/api/v1/me', { headers: auth(tok.token) })).status, 403, 'нет profile:read')
  assert.equal((await app.request('/api/v1/articles', { method: 'POST', headers: auth('wm_pat_nope'), body: '{}' })).status, 401)

  assert.equal((await app.request(`/api/me/tokens/${tok.id}`, { method: 'DELETE', headers: auth(author.accessJwt) })).status, 200)
  const after = await app.request('/api/v1/articles', { method: 'POST', headers: auth(tok.token), body: JSON.stringify({ title: 'x', text: 'y' }) })
  assert.equal(after.status, 401)
})

test('oauth apps: register, secret shown once, rotate, redirect URI rules, owner-only', async () => {
  const app = makeApp()
  const a = await (await app.request('/api/auth/register', json({ ...reg, username: 'devapp', email: 'devapp@example.com' }, '1.1.1.1'))).json()
  const b = await (await app.request('/api/auth/register', json({ ...reg, username: 'other', email: 'other@example.com' }, '1.1.1.1'))).json()
  const auth = (t: string) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' })
  const body = { name: 'Мой блог', homepageUrl: 'https://blog.example', redirectUris: ['https://blog.example/cb', 'http://localhost:5173/cb'] }

  const bad = await app.request('/api/me/oauth-apps', { method: 'POST', headers: auth(a.accessJwt), body: JSON.stringify({ ...body, redirectUris: ['http://evil.example/cb'] }) })
  assert.equal(bad.status, 400)

  const res = await app.request('/api/me/oauth-apps', { method: 'POST', headers: auth(a.accessJwt), body: JSON.stringify(body) })
  assert.equal(res.status, 201)
  const appRow = await res.json()
  assert.match(appRow.clientId, /^wm_app_/)
  assert.match(appRow.clientSecret, /^wm_cs_/)

  const list = await (await app.request('/api/me/oauth-apps', { headers: auth(a.accessJwt) })).json()
  assert.equal(list[0].clientSecret, undefined)

  const rot = await (await app.request(`/api/me/oauth-apps/${appRow.clientId}/secret`, { method: 'POST', headers: auth(a.accessJwt) })).json()
  assert.notEqual(rot.clientSecret, appRow.clientSecret)

  assert.equal((await app.request(`/api/me/oauth-apps/${appRow.clientId}`, { method: 'DELETE', headers: auth(b.accessJwt) })).status, 404, 'чужое не удалить')
  assert.equal((await app.request(`/api/me/oauth-apps/${appRow.clientId}`, { method: 'PATCH', headers: auth(a.accessJwt), body: JSON.stringify({ name: 'Блог 2' }) })).status, 200)
  assert.equal((await app.request(`/api/me/oauth-apps/${appRow.clientId}`, { method: 'DELETE', headers: auth(a.accessJwt) })).status, 200)
})

test('register keeps first-touch UTM; bad UTM is rejected', async () => {
  const app = makeApp()
  const res = await app.request('/api/auth/register', json({ ...reg, username: 'utmuser', email: 'utm@example.com', utm: { source: 'habr', campaign: 'launch' } }, '1.1.1.1'))
  assert.equal(res.status, 201)
  const bad = await app.request('/api/auth/register', json({ ...reg, username: 'utmbad', email: 'utmbad@example.com', utm: { campaign: 'no-source' } }, '1.1.1.1'))
  assert.equal(bad.status, 400)
})

test('consent: registration needs both separate marks; provider sign-up needs consent too', async () => {
  const app = makeApp()
  const noConsent = await app.request('/api/auth/register', json({ ...reg, username: 'nocons', email: 'nocons@example.com', consent: undefined }, '1.1.1.1'))
  assert.equal(noConsent.status, 400)
  const half = await app.request('/api/auth/register', json({ ...reg, username: 'halfcons', email: 'half@example.com', consent: { personalData: true, terms: false } }, '1.1.1.1'))
  assert.equal(half.status, 400)

  const ya = await oauthFlow(app, 'yandex', 'code-ivan', '95.1.1.1', { consent: false })
  assert.equal(ya.searchParams.get('error'), 'ConsentRequired')
  const ok = await oauthFlow(app, 'yandex', 'code-ivan', '95.1.1.1')
  assert.ok(ok.searchParams.get('handoff'))
  // аккаунт уже есть — повторный вход без отметки работает
  assert.ok((await oauthFlow(app, 'yandex', 'code-ivan', '95.1.1.1', { consent: false })).searchParams.get('handoff'))
})

test('personal token: comments and profile scopes', async () => {
  const app = makeApp()
  const u = await (await app.request('/api/auth/register', json({ ...reg, username: 'scopes', email: 'scopes@example.com' }, '1.1.1.1'))).json()
  const auth = (t: string) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' })
  const mk = async (scopes: string[]) =>
    (await (await app.request('/api/me/tokens', { method: 'POST', headers: auth(u.accessJwt), body: JSON.stringify({ name: scopes.join(), scopes }) })).json()).token as string
  const all = await mk(['comments:read', 'comments:write', 'profile:update'])
  const readOnly = await mk(['comments:read'])
  const subject = `at://${u.user.did}/media.weat.article/r1`

  assert.equal((await app.request('/api/v1/comments', { method: 'POST', headers: auth(readOnly), body: JSON.stringify({ subject, text: 'x' }) })).status, 403)
  assert.equal((await app.request('/api/v1/comments', { method: 'POST', headers: auth(all), body: JSON.stringify({ subject: 'https://nope', text: 'x' }) })).status, 400)
  const posted = await app.request('/api/v1/comments', { method: 'POST', headers: auth(all), body: JSON.stringify({ subject, text: 'Отличная статья' }) })
  assert.equal(posted.status, 201)
  assert.match((await posted.json()).uri, /media\.weat\.comment/)

  const mine = await (await app.request('/api/v1/me/comments', { headers: auth(readOnly) })).json()
  assert.equal(mine.comments.at(-1).text, 'Отличная статья')
  assert.deepEqual(mine.comments.at(-1).subject, { uri: subject })

  assert.equal((await app.request('/api/v1/me', { method: 'PATCH', headers: auth(readOnly), body: JSON.stringify({ displayName: 'X' }) })).status, 403)
  const prof = await app.request('/api/v1/me', { method: 'PATCH', headers: auth(all), body: JSON.stringify({ displayName: 'Новое имя', description: 'о себе' }) })
  assert.equal(prof.status, 200)
  assert.equal((await prof.json()).displayName, 'Новое имя')
  assert.equal((await (await app.request(`/api/users/${u.user.handle}`)).json()).displayName, 'Новое имя')
  const cleared = await (await app.request('/api/v1/me', { method: 'PATCH', headers: auth(all), body: JSON.stringify({ description: null }) })).json()
  assert.equal(cleared.description, null)
  assert.equal(cleared.displayName, 'Новое имя', 'остальные поля профиля не трогаем')
})

test('likes: create in reader repo, idempotent, listed, removed (no feed index → repo scan)', async () => {
  const app = makeApp()
  const u = await (await app.request('/api/auth/register', json({ ...reg, username: 'liker', email: 'liker@example.com' }, '1.1.1.1'))).json()
  const auth = { authorization: `Bearer ${u.accessJwt}`, 'content-type': 'application/json' }
  const subject = 'at://did:plc:author/media.weat.article/3k1'
  const like = () => app.request('/api/me/likes', { method: 'POST', headers: auth, body: JSON.stringify({ subject, cid: 'bafy1' }) })

  assert.equal((await app.request('/api/me/likes', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ subject, cid: 'x' }) })).status, 401)
  assert.equal((await app.request('/api/me/likes', { method: 'POST', headers: auth, body: JSON.stringify({ subject: 'at://did:plc:a/media.weat.comment/1', cid: 'x' }) })).status, 400)

  const first = await like()
  assert.equal(first.status, 201)
  const { uri } = await first.json()
  assert.match(uri, /^at:\/\/did:[^/]+\/media\.weat\.like\//)
  const rec = published.at(-1)!
  assert.equal(rec.collection, 'media.weat.like')
  assert.deepEqual(rec.record.subject, { uri: subject, cid: 'bafy1' })

  const again = await like()
  assert.equal(again.status, 200, 'повторный лайк — та же запись')
  assert.equal((await again.json()).uri, uri)

  const list = await (await app.request(`/api/me/likes?subjects=${encodeURIComponent(`${subject},https://x`)}`, { headers: auth })).json()
  assert.deepEqual(list.likes, [{ subject, uri }])

  const del = await (await app.request(`/api/me/likes?subject=${encodeURIComponent(subject)}`, { method: 'DELETE', headers: auth })).json()
  assert.equal(del.removed, 1)
  assert.deepEqual((await (await app.request(`/api/me/likes?subjects=${encodeURIComponent(subject)}`, { headers: auth })).json()).likes, [])
})

test('comments from site session: written to reader repo, reply keeps parent, own delete', async () => {
  const app = makeApp()
  const u = await (await app.request('/api/auth/register', json({ ...reg, username: 'commenter', email: 'commenter@example.com' }, '1.1.1.1'))).json()
  const auth = { authorization: `Bearer ${u.accessJwt}`, 'content-type': 'application/json' }
  const subject = 'at://did:plc:author/media.weat.article/3k1'
  const post = (b: unknown, h: Record<string, string> = auth) => app.request('/api/me/comments', { method: 'POST', headers: h, body: JSON.stringify(b) })

  assert.equal((await post({ subject, text: 'x' }, { 'content-type': 'application/json' })).status, 401)
  assert.equal((await post({ subject, text: '   ' })).status, 400)
  assert.equal((await post({ subject, text: 'x', parent: 'https://evil' })).status, 400)

  const root = await post({ subject, text: ' Отличная статья ' })
  assert.equal(root.status, 201)
  const r = await root.json()
  assert.equal(r.text, 'Отличная статья')
  assert.equal(r.handle, u.user.handle)
  assert.equal(r.parent, null)

  const reply = await (await post({ subject, text: 'Согласен', parent: r.uri })).json()
  assert.equal(reply.parent, r.uri)
  const rec = published.at(-1)!
  assert.equal(rec.collection, 'media.weat.comment')
  assert.deepEqual(rec.record.reply, { parent: { uri: r.uri } })

  const del = await app.request(`/api/me/comments/${reply.uri.split('/').pop()}`, { method: 'DELETE', headers: auth })
  assert.equal(del.status, 200)
  assert.equal((await app.request('/api/feed/comments?subject=https://x')).status, 400)
  assert.equal((await app.request('/api/feed/comments?author=nobody')).status, 400)
  assert.equal((await app.request(`/api/feed/comments?author=${u.user.did}`)).status, 503)
  assert.equal((await app.request(`/api/feed/comments?subject=${encodeURIComponent(subject)}`)).status, 503, 'без индекса ленты треда нет')
})

test('publish from the site: text and video records in the author repo, validation', async () => {
  const app = makeApp()
  const u = await (await app.request('/api/auth/register', json({ ...reg, username: 'videoauthor', email: 'va@example.com' }, '1.1.1.1'))).json()
  const auth = { authorization: `Bearer ${u.accessJwt}`, 'content-type': 'application/json' }
  const pub = (b: unknown, h: Record<string, string> = auth) => app.request('/api/me/articles', { method: 'POST', headers: h, body: JSON.stringify(b) })

  assert.equal((await pub({ title: 't', text: 'x' }, { 'content-type': 'application/json' })).status, 401)
  assert.equal((await pub({ title: 't', text: '' })).status, 400, 'текстовой записи нужен текст')
  assert.equal((await pub({ title: 't', text: '', kind: 'video' })).status, 400, 'видео без ролика')
  assert.equal((await pub({ title: 't', text: '', kind: 'video', videos: [{ source: 'native', url: 'javascript:alert(1)' }] })).status, 400)
  assert.equal((await pub({ title: 't', text: '', kind: 'video', videos: [{ source: 'native', url: 'http://evil.example/x.mp4' }] })).status, 400, 'http — только localhost')
  assert.equal((await pub({ title: 't', text: '', kind: 'video', videos: [{ source: 'youtube' }] })).status, 400, 'youtube без videoId')

  const text = await pub({ title: 'Текст', text: 'Абзац', tags: ['rust'] })
  assert.equal(text.status, 201)
  const t = published.at(-1)!
  assert.equal(t.collection, 'media.weat.article')
  assert.equal(t.record.kind, undefined, 'у текста нет kind')

  const video = await pub({ title: 'Ролик', text: '', kind: 'video', videos: [{ source: 'native', url: 'https://cdn.example/a.mp4', duration: 45 }, { source: 'youtube', videoId: 'dQw4w9WgXcQ' }] })
  assert.equal(video.status, 201)
  const v = published.at(-1)!
  assert.equal(v.record.kind, 'video')
  assert.equal((v.record.videos as unknown[]).length, 2)
  assert.match((await video.json()).uri, /media\.weat\.article/)
})

test('support tickets: guest or user writes, staff reads and changes status (audited)', async () => {
  const app = makeApp()
  const body = { category: 'tech', email: 'reader@example.com', subject: 'Не грузится лента', message: 'Пустая страница после входа, Safari 18.' }
  const post = (b: unknown, h: Record<string, string> = {}) => app.request('/api/support/tickets', { method: 'POST', headers: { 'content-type': 'application/json', ...h }, body: JSON.stringify(b) })

  assert.equal((await post({ ...body, email: 'not-an-email' })).status, 400)
  assert.equal((await post({ ...body, message: 'коротко' })).status, 400)
  const guest = await post(body)
  assert.equal(guest.status, 201)
  const g = await guest.json()
  assert.match(g.id, /^tk_/)
  assert.equal(g.status, 'new')
  assert.equal(g.message, undefined, 'заявителю содержимое не возвращаем')

  const u = await (await app.request('/api/auth/register', json({ ...reg, username: 'ticketer', email: 'ticketer@example.com' }, '1.1.1.1'))).json()
  await post({ ...body, category: 'country-change', subject: 'Смена страны резидентства', countryFrom: 'RU', countryTo: 'GE', docType: 'residence-permit', docFile: { name: 'vnzh.pdf', size: 1000, type: 'application/pdf' } }, { authorization: `Bearer ${u.accessJwt}` })

  assert.equal((await app.request('/api/admin/tickets')).status, 401)
  assert.equal((await app.request('/api/admin/tickets', { headers: { authorization: `Bearer ${u.accessJwt}` } })).status, 401, 'читатель — не сотрудник')
  const staff = { authorization: `Bearer ${await staffToken(['support'])}`, 'content-type': 'application/json' }
  const list = await (await app.request('/api/admin/tickets', { headers: staff })).json()
  assert.equal(list.length, 2)
  assert.equal(list[0].did, u.user.did, 'вошедшему привязан DID')
  assert.deepEqual(list[0].docFile, { name: 'vnzh.pdf', size: 1000, type: 'application/pdf' })
  assert.equal(list[1].did, null, 'гость')

  const patch = (id: string, b: unknown) => app.request(`/api/admin/tickets/${id}`, { method: 'PATCH', headers: staff, body: JSON.stringify(b) })
  assert.equal((await patch(g.id, {})).status, 400)
  assert.equal((await patch('tk_nope', { status: 'resolved' })).status, 404)
  const done = await (await patch(g.id, { status: 'resolved', note: 'Почистили кэш' })).json()
  assert.equal(done.status, 'resolved')
  assert.equal(done.staffNote, 'Почистили кэш')
  assert.equal(auditLog.at(-1)?.action, 'ticket.update')
  assert.equal((await (await app.request('/api/admin/tickets?status=new', { headers: staff })).json()).length, 1)

  // переписка: ответ доходит на площадку только у обращения из аккаунта
  const own = list[0]
  assert.equal(own.deliverable, true)
  assert.equal(list[1].deliverable, false, 'гость (handle не подтверждён) — ответ на площадку не уходит')
  const reply = await app.request(`/api/admin/tickets/${own.id}/messages`, { method: 'POST', headers: staff, body: JSON.stringify({ text: 'Пришлите, пожалуйста, скан ВНЖ на почту.' }) })
  assert.equal(reply.status, 201)
  assert.equal((await reply.json()).status, 'waiting')

  const user = { authorization: `Bearer ${u.accessJwt}`, 'content-type': 'application/json' }
  const mine = await (await app.request('/api/me/tickets', { headers: user })).json()
  assert.equal(mine.length, 1)
  assert.equal(mine[0].unread, 1)
  assert.equal(mine[0].staffNote, undefined, 'внутренняя заметка заявителю не видна')
  assert.equal(mine[0].messages[0].text, 'Пришлите, пожалуйста, скан ВНЖ на почту.')
  await app.request(`/api/me/tickets/${own.id}/seen`, { method: 'POST', headers: user })
  assert.equal((await (await app.request('/api/me/tickets', { headers: user })).json())[0].unread, 0)

  const answer = await (await app.request(`/api/me/tickets/${own.id}/messages`, { method: 'POST', headers: user, body: JSON.stringify({ text: 'Отправил.' }) })).json()
  assert.equal(answer.status, 'in_progress', 'ответ заявителя возвращает в работу')
  assert.equal(answer.messages.length, 2)

  // чужое обращение не открыть и не ответить в него
  const other = await (await app.request('/api/auth/register', json({ ...reg, username: 'stranger', email: 'stranger@example.com' }, '1.1.1.1'))).json()
  const stranger = { authorization: `Bearer ${other.accessJwt}`, 'content-type': 'application/json' }
  assert.equal((await app.request(`/api/me/tickets/${own.id}/messages`, { method: 'POST', headers: stranger, body: JSON.stringify({ text: 'x' }) })).status, 404)
  assert.deepEqual(await (await app.request('/api/me/tickets', { headers: stranger })).json(), [])

  // админка пользователей: поиск, карточка с обращениями, прямое сообщение
  const found = await (await app.request('/api/admin/users?q=ticket', { headers: staff })).json()
  assert.deepEqual(found.map((x: { handle: string }) => x.handle), [u.user.handle])
  assert.equal(found[0].residenceCountry, found[0].signupCountry)
  const card = await (await app.request(`/api/admin/users/${u.user.did}`, { headers: staff })).json()
  assert.equal(card.tickets.length, 1)
  const dm = await app.request(`/api/admin/users/${other.user.did}/messages`, { method: 'POST', headers: staff, body: JSON.stringify({ subject: 'Проверка аккаунта', text: 'Подтвердите, пожалуйста, email.' }) })
  assert.equal(dm.status, 201)
  const inbox = await (await app.request('/api/me/tickets', { headers: stranger })).json()
  assert.equal(inbox.length, 1)
  assert.equal(inbox[0].unread, 1, 'прямое сообщение — непрочитанный ответ поддержки')
  assert.equal(auditLog.at(-1)?.action, 'user.message')
})

test('device journal: sessions recorded on login and refresh, revoked tokens refused', async () => {
  const app = makeApp()
  const mac = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15'
  const win = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36'
  const u = await (await app.request('/api/auth/register', json({ ...reg, username: 'devices', email: 'devices@example.com' }, '1.1.1.1', { 'user-agent': mac }))).json()
  const other = await (await app.request('/api/auth/login', json({ identifier: 'devices.indie.media', password: reg.password }, '1.1.1.1', { 'user-agent': win }))).json()
  const auth = (t: string) => ({ authorization: `Bearer ${t}` })

  const list = await (await app.request('/api/me/sessions', { headers: auth(u.accessJwt) })).json()
  assert.equal(list.length, 2)
  assert.deepEqual(list.map((s: { device: string }) => s.device).sort(), ['Chrome · Windows', 'Safari · macOS'])
  assert.equal(list.find((s: { current: boolean }) => s.current).device, 'Safari · macOS', 'это устройство')

  // обновление — та же сессия, не новая
  const refreshed = await (await app.request('/api/auth/refresh', json({ refreshJwt: other.refreshJwt }, '1.1.1.1', { 'user-agent': win }))).json()
  assert.ok(refreshed.accessJwt)
  assert.equal((await (await app.request('/api/me/sessions', { headers: auth(u.accessJwt) })).json()).length, 2)

  // «Завершить все, кроме этого» — токены Windows больше не принимаются, и refresh тоже
  const r = await (await app.request('/api/me/sessions/revoke-others', { method: 'POST', headers: auth(u.accessJwt) })).json()
  assert.equal(r.revoked, 1)
  const denied = await app.request('/api/me', { headers: auth(refreshed.accessJwt) })
  assert.equal(denied.status, 401)
  assert.equal((await denied.json()).error, 'SessionRevoked')
  assert.equal((await app.request('/api/auth/refresh', json({ refreshJwt: refreshed.refreshJwt }, '1.1.1.1'))).status, 401)
  assert.equal((await app.request('/api/me', { headers: auth(u.accessJwt) })).status, 200, 'своё устройство работает')

  // сотрудник видит и завершает всё — в аудит
  const staff = { authorization: `Bearer ${await staffToken(['support'])}`, 'content-type': 'application/json' }
  assert.equal((await (await app.request(`/api/admin/users/${u.user.did}/sessions`, { headers: staff })).json()).length, 2)
  const all = await (await app.request(`/api/admin/users/${u.user.did}/sessions/revoke-all`, { method: 'POST', headers: staff })).json()
  assert.equal(all.revoked, 1)
  assert.equal(auditLog.at(-1)?.action, 'session.revoke_all')
  assert.equal((await app.request('/api/me', { headers: auth(u.accessJwt) })).status, 401)
})

test('lava.top: invoice, forged webhook refused, access only after API confirms, idempotent', async () => {
  const app = makeApp()
  const author = await (await app.request('/api/auth/register', json({ ...reg, username: 'lavaauthor', email: 'la@example.com' }, '1.1.1.1'))).json()
  const reader = await (await app.request('/api/auth/register', json({ ...reg, username: 'lavareader', email: 'lr@example.com' }, '1.1.1.1'))).json()
  const auth = (t: string) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' })
  const pub = await app.request('/api/me/articles/paid', {
    method: 'POST', headers: auth(author.accessJwt),
    body: JSON.stringify({ title: 'Платная', teaser: 'тизер', body: 'СЕКРЕТ', paywall: { accessType: 'one-time', price: 19900, currency: 'RUB' } }),
  })
  const { id: contentId } = await pub.json()

  const buy = await app.request('/api/me/purchases', { method: 'POST', headers: auth(reader.accessJwt), body: JSON.stringify({ contentId, paymentMethod: 'SBP' }) })
  assert.equal(buy.status, 201, await buy.clone().text())
  const { orderId, paymentUrl } = await buy.json()
  assert.match(paymentUrl, /^https:\/\/pay\.lava/)
  const req = lavaRequests.at(-1)!
  assert.equal(req.amount, 199, 'копейки -> рубли')
  assert.equal(req.currency, 'RUB')
  assert.equal(req.paymentMethod, 'SBP')
  assert.equal(req.successful_return_url, undefined, 'http-стенд: без return URL')
  const contractId = [...lavaInvoices.keys()].at(-1)!

  const hook = (body: unknown, key = 'lava-webhook-secret-0123') =>
    app.request('/api/webhooks/payment', { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': key }, body: JSON.stringify(body) })
  const success = { eventType: 'payment.success', contractId, amount: 199, currency: 'RUB', status: 'completed' }
  const read = () => app.request(`/api/paid-content/${contentId}`, { headers: auth(reader.accessJwt) })

  assert.equal((await hook(success, 'wrong-key-wrong-key-0000')).status, 401)
  // тело подделано: lava.top говорит, что счёт не оплачен
  assert.equal((await hook(success)).status, 503)
  assert.equal((await read()).status, 402)

  lavaInvoices.set(contractId, { id: contractId, status: 'COMPLETED', receipt: { amount: 199, currency: 'RUB' } })
  assert.equal((await hook(success)).status, 200)
  assert.equal((await hook(success)).status, 200, 'повтор вебхука')
  assert.equal((await read()).status, 200)
  const order = await (await app.request(`/api/me/purchases/${orderId}`, { headers: auth(reader.accessJwt) })).json()
  assert.equal(order.status, 'paid')
  assert.equal((await app.request(`/api/me/purchases/${orderId}`, { headers: auth(author.accessJwt) })).status, 404, 'чужой заказ')
  assert.equal((await app.request('/api/me/purchases', { method: 'POST', headers: auth(reader.accessJwt), body: JSON.stringify({ contentId }) })).status, 409)
  assert.equal((await hook({ event_type: 'refund.success', data: {} })).status, 200, 'неизвестный формат — 200')
})

test('lava.top: Premium author keeps 99% of a sale, regular — 90%', async () => {
  const app = makeApp()
  const auth = (t: string) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' })
  const mk = (u: string) => app.request('/api/auth/register', json({ ...reg, username: u, email: `${u}@example.com` }, '1.1.1.1')).then((r) => r.json())
  const prem = await mk('splitprem')
  const reader = await mk('splitreader')
  await app.request(`/api/admin/users/${prem.user.did}/tier`, { method: 'PUT', headers: auth('admin-token-0123456789'), body: JSON.stringify({ tier: 'premium' }) })
  const { id } = await (await app.request('/api/me/articles/paid', { method: 'POST', headers: auth(prem.accessJwt), body: JSON.stringify({ title: 'P', teaser: 't', body: 'b', paywall: { accessType: 'one-time', price: 10000, currency: 'RUB' } }) })).json()
  const { orderId } = await (await app.request('/api/me/purchases', { method: 'POST', headers: auth(reader.accessJwt), body: JSON.stringify({ contentId: id }) })).json()
  const o = await ordersLast!.get(orderId)
  assert.deepEqual([o!.author_share, o!.platform_fee], [9900, 100])
})

test('rate limit: login brute force gets 429 per IP, other IPs and routes unaffected', async () => {
  const app = makeApp({ rateLimit: true })
  const attempt = (ip: string) => app.request('/api/auth/login', json({ identifier: 'nobody.indie.media', password: 'wrong-password' }, ip))
  for (let i = 0; i < 10; i++) assert.equal((await attempt('7.7.7.7')).status, 401)
  const blocked = await attempt('7.7.7.7')
  assert.equal(blocked.status, 429)
  assert.ok(Number(blocked.headers.get('retry-after')) > 0)
  assert.equal((await blocked.json()).error, 'RateLimited')
  assert.equal((await attempt('8.8.8.8')).status, 401, 'другой IP')
  assert.equal((await app.request('/api/geo', { headers: { 'x-forwarded-for': '7.7.7.7' } })).status, 200, 'другое правило')
  assert.equal((await app.request('/api/health')).status, 200)
})

test('body limit: oversized JSON rejected before parsing', async () => {
  const app = makeApp()
  const big = JSON.stringify({ identifier: 'x', password: 'a'.repeat(70 * 1024) })
  const res = await app.request('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json', 'content-length': String(big.length) }, body: big })
  assert.equal(res.status, 413)
})

test('staff: Zitadel JWT with project roles; wrong issuer/audience/expired refused; actions audited', async () => {
  const app = makeApp()
  const u = await (await app.request('/api/auth/register', json({ ...reg, username: 'staffcheck', email: 'staff@example.com' }, '1.1.1.1'))).json()
  const as = (t: string) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' })
  const tier = (t: string) => app.request(`/api/admin/users/${u.user.did}/tier`, { method: 'PUT', headers: as(t), body: JSON.stringify({ tier: 'premium' }) })

  assert.equal((await app.request('/api/admin/me')).status, 401)
  assert.equal((await app.request('/api/admin/me', { headers: as(u.accessJwt) })).status, 401, 'токен читателя — не сотрудник')
  const support = await staffToken(['support'])
  const me = await (await app.request('/api/admin/me', { headers: as(support) })).json()
  assert.deepEqual(me.roles, ['support'])
  assert.equal((await tier(support)).status, 403, 'support не меняет тариф')

  assert.equal((await tier(await staffToken(['admin'], { iss: 'https://evil.test' }))).status, 401)
  assert.equal((await tier(await staffToken(['admin'], { aud: 'other-project' }))).status, 401)
  assert.equal((await tier(await staffToken(['admin'], { exp: '-1m' }))).status, 401)

  const admin = await staffToken(['admin'], { sub: 'u-admin' })
  assert.equal((await tier(admin)).status, 200)
  const log = await (await app.request('/api/admin/audit', { headers: as(admin) })).json()
  assert.equal(log[0].action, 'user.tier')
  assert.equal(log[0].actor, 'zitadel:u-admin')
  assert.equal(log[0].target, u.user.did)
  assert.equal((await app.request('/api/admin/audit', { headers: as(support) })).status, 403)
})

test('profile shows paid subscriber count (aggregate only)', async () => {
  const app = makeApp()
  const author = await (await app.request('/api/auth/register', json({ ...reg, username: 'subauthor', email: 'sa@example.com' }, '1.1.1.1'))).json()
  const r1 = await (await app.request('/api/auth/register', json({ ...reg, username: 'subr1', email: 'r1@example.com' }, '1.1.1.1'))).json()
  const r2 = await (await app.request('/api/auth/register', json({ ...reg, username: 'subr2', email: 'r2@example.com' }, '1.1.1.1'))).json()
  const grant = (body: unknown) => app.request('/api/admin/entitlements', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer admin-token-0123456789' }, body: JSON.stringify(body) })
  await grant({ readerDid: r1.user.did, authorDid: author.user.did })
  await grant({ readerDid: r1.user.did, authorDid: author.user.did, tierId: 't2' })
  await grant({ readerDid: r2.user.did, authorDid: author.user.did, expiresAt: '2020-01-01T00:00:00Z' })
  const p = await (await app.request(`/api/users/${author.user.handle}`)).json()
  assert.equal(p.paidSubscribers, 1, 'один читатель с двумя тарифами — один; истёкшая подписка не считается')
})

test('feed: articles from all repos of our PDS, newest first, crawler source kept', async () => {
  const app = makeApp()
  const a = await (await app.request('/api/auth/register', json({ ...reg, username: 'feedauthor', email: 'fa@example.com' }, '1.1.1.1'))).json()
  published.push({ repo: a.user.did, collection: 'media.weat.article', record: { title: 'Старая', text: 'x', createdAt: '2026-01-01T00:00:00Z' } })
  published.push({ repo: a.user.did, collection: 'media.weat.article', record: { title: 'Новая', text: 'y', createdAt: '2026-11-12T00:00:00Z', source: { url: 'https://habr.com/x', site: 'habr.com' } } })
  published.push({ repo: a.user.did, collection: 'media.weat.comment', record: { text: 'не статья' } })
  const res = await (await app.request('/api/feed')).json()
  const mine = res.articles.filter((x: { did: string }) => x.did === a.user.did)
  assert.deepEqual(mine.map((x: { record: { title: string } }) => x.record.title), ['Новая', 'Старая'])
  assert.equal(mine[0].handle, a.user.handle)
  assert.equal(mine[0].record.source.site, 'habr.com')
})

test('ownership claims: per source author, one claimant, code issued, support decides, audited', async () => {
  const app = makeApp()
  const reg2 = (u: string) => app.request('/api/auth/register', json({ ...reg, username: u, email: `${u}@example.com` }, '1.1.1.1')).then((r) => r.json())
  // «краулер» — аккаунт с handle crawler-…
  const crawler = await reg2('crawler-habr-9')
  const alice = await reg2('claimalice')
  const bob = await reg2('claimbob')
  const add = (record: Record<string, unknown>) => {
    published.push({ repo: crawler.user.did, collection: 'media.weat.article', record })
    return `at://${crawler.user.did}/media.weat.article/r${published.length}`
  }
  const byIlya = add({ title: 'A', text: 'x', source: { site: 'habr.com', author: 'ilya_bashkirov', authorUrl: 'https://habr.com/ru/users/ilya_bashkirov/' } })
  const noAuthor = add({ title: 'B', text: 'y', source: { site: 'opennet.ru' } })
  const own = `at://${alice.user.did}/media.weat.article/r1`
  const auth = (t: string) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' })
  const claim = (t: string, articleUri: string) => app.request('/api/me/claims', { method: 'POST', headers: auth(t), body: JSON.stringify({ articleUri }) })

  assert.equal((await claim(alice.accessJwt, own)).status, 400, 'не краулер')
  const first = await claim(alice.accessJwt, byIlya)
  assert.equal(first.status, 201)
  const c1 = await first.json()
  assert.equal(c1.sourceAuthor, 'ilya_bashkirov')
  assert.match(c1.code, /^weat-[0-9a-f]{10}$/)
  assert.equal((await (await claim(alice.accessJwt, byIlya)).json()).id, c1.id, 'идемпотентно')
  assert.equal((await claim(bob.accessJwt, byIlya)).status, 409, 'второй заявитель на того же автора')
  const solo = await (await claim(bob.accessJwt, noAuthor)).json()
  assert.equal(solo.sourceAuthor, null, 'без автора — только эта статья')

  const support = await staffToken(['support'], { sub: 'u-sup' })
  const list = await (await app.request('/api/admin/claims?status=pending', { headers: auth(support) })).json()
  assert.ok(list.some((x: { id: string; claimant: { handle: string } }) => x.id === c1.id && x.claimant.handle === alice.user.handle))
  assert.equal((await app.request(`/api/admin/claims/${c1.id}/reject`, { method: 'POST', headers: auth(support), body: '{}' })).status, 400, 'отказ без причины')
  const ok = await (await app.request(`/api/admin/claims/${c1.id}/approve`, { method: 'POST', headers: auth(support), body: '{}' })).json()
  assert.equal(ok.status, 'approved')
  assert.equal((await app.request(`/api/admin/claims/${c1.id}/approve`, { method: 'POST', headers: auth(support), body: '{}' })).status, 404, 'повторно не решить')
  assert.equal(auditLog.at(-1)!.action, 'claim.approve')
  assert.equal((await app.request('/api/admin/claims', { headers: auth(alice.accessJwt) })).status, 401, 'читатель не видит заявки')
})

test('personal token: rotate keeps identity, old value dies; token can revoke itself', async () => {
  const app = makeApp()
  const u = await (await app.request('/api/auth/register', json({ ...reg, username: 'rotator', email: 'rot@example.com' }, '1.1.1.1'))).json()
  const auth = (t: string) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' })
  const t1 = await (await app.request('/api/me/tokens', { method: 'POST', headers: auth(u.accessJwt), body: JSON.stringify({ name: 'CI', scopes: ['profile:read'], expiresInDays: 30 }) })).json()
  const me = (t: string) => app.request('/api/v1/me', { headers: auth(t) })
  assert.equal((await me(t1.token)).status, 200)

  const r = await app.request(`/api/me/tokens/${t1.id}/rotate`, { method: 'POST', headers: auth(u.accessJwt), body: '{}' })
  assert.equal(r.status, 200)
  const t2 = await r.json()
  assert.equal(t2.id, t1.id, 'тот же токен')
  assert.notEqual(t2.token, t1.token)
  assert.deepEqual(t2.scopes, ['profile:read'])
  assert.equal((await me(t1.token)).status, 401, 'старое значение не работает')
  assert.equal((await me(t2.token)).status, 200)
  assert.equal((await app.request(`/api/me/tokens/${t1.id}/rotate`, { method: 'POST', headers: auth(t2.token), body: '{}' })).status, 403, 'токеном токен не вращают')

  assert.equal((await app.request('/api/v1/token', { method: 'DELETE', headers: auth(t2.token) })).status, 200)
  assert.equal((await me(t2.token)).status, 401, 'отозван сам собой')
  assert.equal((await app.request('/api/v1/token', { method: 'DELETE', headers: auth('wm_pat_unknown') })).status, 200, 'ответ не выдаёт, был ли токен')
  const list = await (await app.request('/api/me/tokens', { headers: auth(u.accessJwt) })).json()
  assert.equal(list.length, 0, 'при визите владельца истёкший убран вместе с app password')
})
