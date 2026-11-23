import type { PeerContour } from '../src/contour.ts'
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
import type { LavaClient, LavaInvoiceInfo, OrderRepo, OrderRow, PremiumOrderRepo, PremiumOrderRow } from '../src/lava.ts'
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose'
import { createStaffVerifier, type AuditEntry, type AuditRepo } from '../src/staff.ts'
import type { ClaimRepo, ClaimRow } from '../src/claims.ts'
import type { MessageRow, TicketRepo, TicketRow } from '../src/tickets.ts'
import type { AtprotoAuth } from '../src/atprotoOAuth.ts'
import type { ImportDraftRow, ImportRepo, PostSource } from '../src/imports.ts'
import type { MailboxClient, MailboxId, MailMessage } from '../src/mailbox.ts'
import { payoutHasDeficit, type AdjustmentRow, type PayoutRepo, type PayoutRow } from '../src/payouts.ts'
import type { SystemAccountRepo } from '../src/systemAccounts.ts'
import type { DraftRepo, DraftRow } from '../src/drafts.ts'
import type { CollectionRepo, CollectionRow } from '../src/collections.ts'
import { createCooldown, memCooldown, type Cooldown } from '../src/cooldown.ts'
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
  const moves = new Map<string, string>()
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
    async transferred(id, m) {
      for (const x of m) moves.set(x.oldUri, x.newUri)
      const r = rows.find((x) => x.id === id && x.status === 'approved')
      if (r) r.status = 'transferred'
    },
    async movedTo(uris) { return new Map(uris.filter((u) => moves.has(u)).map((u) => [u, moves.get(u)!])) },
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
  const adj: AdjustmentRow[] = []
  const balances: PayoutRepo['balances'] = async (did, holdDays) => {
    const cur = new Set([...paidSales.filter((x) => x.author === did).map((x) => x.currency), ...rows.filter((x) => x.author_did === did).map((x) => x.currency), ...adj.filter((x) => x.did === did).map((x) => x.currency)])
    const since = Date.now() - holdDays * 86_400_000
    return [...cur].sort().map((currency) => {
      const mine = paidSales.filter((x) => x.author === did && x.currency === currency)
      const earned = mine.reduce((a, x) => a + x.share, 0) + adj.filter((x) => x.did === did && x.currency === currency).reduce((a, x) => a + x.amount, 0)
      const pending = mine.filter((x) => +x.paidAt > since).reduce((a, x) => a + x.share, 0)
      const po = rows.filter((x) => x.author_did === did && x.currency === currency)
      const adjusted = adj.filter((x) => x.did === did && x.currency === currency).reduce((a, x) => a + x.amount, 0)
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
      if (r && status === 'paid') {
        const b = (await balances(r.author_did, 14)).find((x) => x.currency === r.currency)
        if (!b || payoutHasDeficit(b)) throw new PdsError(409, 'InsufficientBalance', 'После возврата доступного баланса недостаточно')
      }
      if (r) Object.assign(r, { status, decided_by: by, staff_note: note, decided_at: new Date() })
      return r
    },
    async adjust(a) {
      const row = { ...a, created_at: new Date() }
      adj.push(row)
      return row
    },
    async adjustments(did) { return adj.filter((x) => !did || x.did === did).reverse() },
    async summary() {
      const cur = [...new Set(paidSales.map((x) => x.currency))]
      return cur.map((currency) => {
        const share = paidSales.filter((x) => x.currency === currency).reduce((a, x) => a + x.share, 0)
        return { currency, gross: share * 2, platformFee: share, authorShare: share, orders: paidSales.length, refunded: 0, payoutsRequested: 0, payoutsPaid: 0, adjustments: adj.filter((x) => x.currency === currency).reduce((a, x) => a + x.amount, 0) }
      })
    },
    async recentOrders() { return [] },
  }
}

function memDrafts(): DraftRepo {
  const rows = new Map<string, DraftRow>()
  return {
    async list(did) { return [...rows.values()].filter((r) => r.did === did).sort((a, b) => +b.updated_at - +a.updated_at) },
    async get(did, id) { const r = rows.get(id); return r?.did === did ? r : undefined },
    async save(did, id, title, text, meta) {
      const cur = rows.get(id)
      if (cur && cur.did !== did) throw new Error('foreign')
      const row = { id, did, title, text, meta: meta ?? cur?.meta ?? {}, created_at: cur?.created_at ?? new Date(), updated_at: new Date() }
      rows.set(id, row)
      return row
    },
    async remove(did, id) { const r = rows.get(id); return r?.did === did ? rows.delete(id) : false },
    async count(did) { return [...rows.values()].filter((r) => r.did === did).length },
  }
}

function memCollections(): CollectionRepo {
  const rows = new Map<string, CollectionRow>()
  return {
    async list(did) { return [...rows.values()].filter((r) => !did || r.did === did) },
    async get(id) { return rows.get(id) },
    async save(r) {
      const cur = rows.get(r.id)
      if (cur && cur.did !== r.did) throw new PdsError(404, 'NotFound', 'Подборка не найдена')
      const row = { ...r, created_at: cur?.created_at ?? new Date(), updated_at: new Date() }
      rows.set(r.id, row)
      return row
    },
    async remove(did, id) { const r = rows.get(id); return r?.did === did ? rows.delete(id) : false },
  }
}

function memSystem(): SystemAccountRepo {
  const rows = new Map<string, string>()
  return { async insert(did, enc) { rows.set(did, enc) }, async password(did) { return rows.get(did) } }
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
      if (prev) return void Object.assign(prev, { access_hash: s.accessHash, refresh_hash: s.refreshHash, refresh_enc: s.refreshEnc ?? null, last_seen_at: new Date(), country: s.country })
      rows.push({ id: `ses_${++n}`, did: s.did, access_hash: s.accessHash, refresh_hash: s.refreshHash, refresh_enc: s.refreshEnc ?? null, device: s.device, country: s.country, created_at: new Date(), last_seen_at: new Date(), revoked_at: null, revoked_by: null })
    },
    async isRevoked(h) {
      const hit = rows.filter((r) => r.access_hash === h || r.refresh_hash === h)
      return hit.length > 0 && hit.every((r) => !!r.revoked_at)
    },
    async byAccess(h) { return rows.filter((r) => r.access_hash === h).sort((a, b) => Number(!!a.revoked_at) - Number(!!b.revoked_at))[0] },
    async list(did) { return rows.filter((r) => r.did === did) },
    async revoke(did, ids, by, keep) {
      const hit = rows.filter((r) => r.did === did && !r.revoked_at && (ids ? ids.includes(r.id) : r.id !== keep))
      const refresh = hit.map((r) => r.refresh_enc).filter((e): e is string => !!e)
      for (const r of hit) Object.assign(r, { revoked_at: new Date(), revoked_by: by, refresh_enc: null })
      return { count: hit.length, refresh }
    },
  }
}

const auditLog: AuditEntry[] = []
/** порядок создания пользователей во всех тестовых приложениях */
let userSeq = 0
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
        // секунда на каждого следующего: «кто создан раньше» различим
        created_at: new Date(Date.parse('2026-11-12T10:00:00Z') + userSeq++ * 1000),
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
    async search(q, limit, opts) {
      const t = q.trim().toLowerCase()
      const term = t.replace(/^@/, '')
      return [...rows.values()].filter((r) => (!term || r.did === term || r.handle.includes(term) || (r.display_name ?? '').toLowerCase().includes(term)) && (!opts?.service || !!r.service)).slice(0, limit)
    },
    async setHandle(did, handle) {
      const r = rows.get(did)
      if (r) r.handle = handle
    },
    async setService(did, service) {
      const r = rows.get(did)
      if (r) r.service = service
    },
    async setAvatar(did, cid) {
      const r = rows.get(did)
      if (r) r.avatar_cid = cid
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
    async revokeByPayment(ref) {
      const hit = ents.filter((e) => e.paymentRef === ref && (!e.expiresAt || e.expiresAt > new Date()))
      for (const e of hit) e.expiresAt = new Date(Date.now() - 1)
      return hit.length
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
    async refund(id) {
      const o = rows.get(id)
      if (!o || o.status !== 'paid') return false
      o.status = 'refunded'
      return true
    },
  }
}

function memPremiumOrders(): PremiumOrderRepo {
  const rows = new Map<string, PremiumOrderRow>()
  const until = (did: string) => Math.max(Date.now(), ...[...rows.values()].filter((r) => r.did === did && r.status === 'paid').map((r) => r.paid_until!.getTime()))
  return {
    async insert(o) { rows.set(o.id, { ...o, status: 'pending', created_at: new Date(), paid_at: null, paid_until: null }) },
    async get(id) { return rows.get(id) },
    async byContract(c) { return [...rows.values()].find((o) => o.contract_id === c) },
    async pay(id) {
      const o = rows.get(id)
      if (!o || o.status !== 'pending') return undefined
      o.paid_until = new Date(until(o.did) + o.days * 86_400_000)
      o.status = 'paid'
      o.paid_at = new Date()
      return o
    },
    async fail(id) { const o = rows.get(id); if (o?.status === 'pending') o.status = 'failed' },
    async refund(id) {
      const o = rows.get(id)
      if (!o || o.status !== 'paid') return undefined
      o.status = 'refunded'
      return { did: o.did, stillPaid: [...rows.values()].some((r) => r.did === o.did && r.status === 'paid' && r.paid_until! > new Date()) }
    },
    async expired() { return [] },
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

/** refresh-токены, отозванные в PDS (deleteSession) */
const pdsDeleted: string[] = []

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
    async updateHandle(jwt, handle) {
      const { handle: old, acct } = tokenUser(jwt)
      if (accounts.has(handle)) throw new PdsError(409, 'HandleTaken', 'Этот username уже занят')
      accounts.delete(old)
      accounts.set(handle, acct)
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
    async deleteSession(refreshJwt) {
      pdsDeleted.push(refreshJwt)
    },
    async uploadBlob(_jwt, bytes, mimeType) {
      return { blob: { $type: 'blob', ref: { $link: `bafyavatar${bytes.byteLength}` }, mimeType, size: bytes.byteLength } }
    },
    async refreshSession(refreshJwt) {
      if (pdsDeleted.includes(refreshJwt)) throw new PdsError(401, 'ExpiredToken', 'revoked')
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
    async didForIdentifier(identifier) {
      const id = identifier.trim().toLowerCase()
      if (id.startsWith('did:')) return byDid(id)?.[1].did
      return [...accounts.entries()].find(([h, a]) => h === id || a.email.toLowerCase() === id)?.[1].did
    },
    async adminUpdatePassword(did, password) {
      const hit = byDid(did)
      if (!hit) throw new PdsError(404, 'RepoNotFound', 'no repo')
      hit[1].password = password
    },
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
      stored.delete(`${repo}/${collection}/${rkey}`)
      const i = published.findIndex((p) => p.repo === repo && p.collection === collection && `r${published.indexOf(p) + 1}` === rkey)
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

let cooldownLast: Cooldown | undefined
function makeApp(opts: { peerSecret?: string; cooldown?: boolean; rateLimit?: boolean; contour?: 'global' | 'ru'; ipCountry?: Record<string, string>; peer?: Deps['peer']; nodeRole?: 'primary' | 'standby'; atproto?: boolean; restricted?: Deps['restricted']; feedUrl?: string } = {}) {
  const deps: Deps = {
    config: {
      CONTOUR: opts.contour ?? 'global',
      PDS_HANDLE_DOMAIN: 'indie.media',
      PDS_HOST: 'pds.indie.media',
      TRUST_PROXY: true,
      ADMIN_TOKEN: 'admin-token-0123456789',
      ...(opts.peerSecret ? { PEER_SECRET: opts.peerSecret } : {}),
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
    premiumOrders: memPremiumOrders(),
    claims: memClaims(),
    tickets: memTickets(),
    sessions: memSessions(),
    imports: memImports(),
    mail: memMail(),
    payouts: memPayouts(),
    system: memSystem(),
    drafts: memDrafts(),
    collections: memCollections(),
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
    restricted: opts.restricted,
    feedUrl: opts.feedUrl,
    nodeRole: opts.nodeRole,
  }
  cooldownLast = opts.cooldown ? createCooldown({ pds: deps.pds, secrets: deps.secrets, repo: memCooldown(), ms: 60_000, siteUrl: 'http://localhost:3000' }) : undefined
  deps.cooldown = cooldownLast
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
  assert.deepEqual(geo, { country: 'NL', contour: 'ru', allowed: false, providers: ['yandex'], hiddenCollegia: ['nsfw', 'politics'] })

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
  assert.equal(me.headers.get('cache-control'), 'private, no-store')

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

test('payouts: refund after reservation cannot be approved as paid', async () => {
  const app = makeApp({ ipCountry: { '5.1.1.1': 'DE' } })
  const u = await (await app.request('/api/auth/register', json({ ...reg, username: 'refundwriter', email: 'refundwriter@example.com' }, '5.1.1.1'))).json()
  paidSales = [{ author: u.user.did, share: 110_000, currency: 'RUB', paidAt: new Date(Date.now() - 30 * 86_400_000), title: 'Возврат' }]
  const po = await (await app.request('/api/me/payouts', { method: 'POST', headers: { authorization: `Bearer ${u.accessJwt}`, 'content-type': 'application/json' }, body: JSON.stringify({ currency: 'RUB', method: 'fiat', destination: '4242 4242 4242 4242' }) })).json()
  paidSales = []
  const admin = { authorization: `Bearer ${await staffToken(['admin'])}`, 'content-type': 'application/json' }
  const paid = await app.request(`/api/admin/payouts/${po.id}`, { method: 'PATCH', headers: admin, body: JSON.stringify({ status: 'paid' }) })
  assert.equal(paid.status, 409, 'после refund заявка не проходит без пересчёта')
  const rejected = await app.request(`/api/admin/payouts/${po.id}`, { method: 'PATCH', headers: admin, body: JSON.stringify({ status: 'rejected', note: 'Заказ возвращён покупателю' }) })
  assert.equal(rejected.status, 200, 'заявку можно отклонить с причиной')
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

test('share: readable article HTML escapes fields and includes BlogPosting and original canonical; unknown id returns 404', async () => {
  const { sharePage, plainExcerpt, sitemapXml } = await import('../src/share.ts')
  const html = sharePage({ siteName: 'weAT.media', siteUrl: 'https://weat.media', url: 'https://weat.media/article/x-abcdef', canonicalUrl: 'https://example.com/original?a=1&b=2', title: 'A <b>"x"</b>', description: 'd&d', image: 'https://weat.media/og-image.png', text: '## Ответ\n\nТекст **важно**', author: '@author', publishedAt: '2026-01-01T00:00:00Z' })
  assert.match(html, /<meta property="og:title" content="A &lt;b&gt;&quot;x&quot;&lt;\/b&gt;">/)
  assert.match(html, /<link rel="canonical" href="https:\/\/example.com\/original\?a=1&amp;b=2">/)
  assert.match(html, /<meta property="og:url" content="https:\/\/weat.media\/article\/x-abcdef">/)
  assert.match(html, /"mainEntityOfPage":"https:\/\/example.com\/original\?a=1&b=2"/)
  assert.match(html, /<meta name="twitter:card" content="summary_large_image">/)
  assert.match(html, /"@type":"BlogPosting"/)
  assert.match(html, /<h3>Ответ<\/h3>/)
  assert.match(html, /<strong>важно<\/strong>/)
  assert.equal(plainExcerpt('# Заголовок\n\nТекст со [ссылкой](https://x) и ![img](u) **жирным**'), 'Заголовок Текст со ссылкой и жирным')
  assert.match(sitemapXml([{ loc: 'https://weat.media/article/a?x=1&y=2', lastmod: '2026-01-01' }]), /<loc>https:\/\/weat.media\/article\/a\?x=1&amp;y=2<\/loc><lastmod>2026-01-01<\/lastmod>/)
  const app = makeApp()
  const res = await app.request('/api/share/article/not%20an%20id')
  assert.equal(res.status, 404)
  assert.match(await res.text(), /<meta name="robots" content="noindex">/)
})

test('global contour: from a Russian IP foreign providers (Telegram, Google, AT) are hidden and refused', async () => {
  const app = makeApp({ atproto: true, ipCountry: { '95.1.1.1': 'RU', '5.1.1.1': 'DE' } })
  const ru = await (await app.request('/api/geo', { headers: { 'x-forwarded-for': '95.1.1.1' } })).json()
  assert.deepEqual(ru.providers, ['yandex'])
  const de = await (await app.request('/api/geo', { headers: { 'x-forwarded-for': '5.1.1.1' } })).json()
  assert.ok(de.providers.includes('telegram'))
  assert.equal((await app.request('/api/auth/telegram/start', { headers: { 'x-forwarded-for': '95.1.1.1' } })).status, 403)
  const at = await app.request('/api/auth/atproto/start?handle=perfscale.su', { headers: { 'x-forwarded-for': '95.1.1.1' } })
  assert.equal(new URL(at.headers.get('location')!).searchParams.get('error'), 'ProviderForbidden')
  // привязанный Telegram: вход с российского IP закрыт, из Германии — открыт
  const { accessJwt } = await registerWithPassword(app, '5.1.1.1')
  await oauthFlow(app, 'telegram', 'code-tg', '5.1.1.1', { linkToken: accessJwt })
  const cbFromRu = await oauthFlow(app, 'telegram', 'code-tg', '95.1.1.1').catch(() => null)
  assert.ok(cbFromRu === null || cbFromRu.searchParams.get('error') === 'ProviderForbidden')
})

test('finance: admin sees totals, credits and debits a user balance with reason; debit cannot exceed available', async () => {
  const app = makeApp({ ipCountry: { '5.1.1.1': 'DE' } })
  const u = await (await app.request('/api/auth/register', json({ ...reg, username: 'fin', email: 'fin@example.com' }, '5.1.1.1'))).json()
  paidSales = [{ author: u.user.did, share: 50_000, currency: 'RUB', paidAt: new Date(Date.now() - 30 * 86_400_000), title: 'Т' }]
  const support = { authorization: `Bearer ${await staffToken(['support'])}`, 'content-type': 'application/json' }
  const admin = { authorization: `Bearer ${await staffToken(['admin'])}`, 'content-type': 'application/json' }
  assert.equal((await app.request('/api/admin/finance/summary', { headers: support })).status, 403)
  const sum = await (await app.request('/api/admin/finance/summary', { headers: admin })).json()
  assert.equal(sum.totals[0].authorShare, 50_000)

  const adjust = (b: unknown) => app.request('/api/admin/finance/adjustments', { method: 'POST', headers: admin, body: JSON.stringify(b) })
  assert.equal((await adjust({ user: 'fin.indie.media', amount: 10_000, currency: 'RUB', reason: 'x' })).status, 400, 'причина короткая')
  assert.equal((await adjust({ user: 'nobody.indie.media', amount: 10_000, currency: 'RUB', reason: 'Бонус за конкурс' })).status, 404)
  assert.equal((await adjust({ user: 'fin.indie.media', amount: 25_000, currency: 'RUB', reason: 'Бонус за конкурс' })).status, 201)
  assert.equal((await adjust({ user: u.user.did, amount: -100_000, currency: 'RUB', reason: 'Ошибочное начисление' })).status, 409, 'не ниже нуля')
  assert.equal((await adjust({ user: u.user.did, amount: -5_000, currency: 'RUB', reason: 'Исправление суммы' })).status, 201)

  const card = await (await app.request('/api/admin/finance/users/fin.indie.media', { headers: admin })).json()
  assert.equal(card.balances[0].available, 70_000)
  assert.equal(card.adjustments.length, 2)
  const mine = await (await app.request('/api/me/earnings', { headers: { authorization: `Bearer ${u.accessJwt}` } })).json()
  assert.equal(mine.balances[0].available, 70_000, 'автор видит скорректированный баланс')
  assert.ok(auditLog.filter((e) => e.action === 'finance.adjust').length >= 2)
})

test('app CORS: bsky.app can call the public PDS createSession gate', async () => {
  const app = makeApp()
  const res = await app.request('/api/pds/createSession', { method: 'OPTIONS', headers: { origin: 'https://bsky.app', 'access-control-request-method': 'POST' } })
  assert.equal(res.status, 204)
  assert.equal(res.headers.get('access-control-allow-origin'), '*')
})

test('pds gate: external createSession — TOTP account with main password refused and session revoked; app password and non-TOTP pass', async () => {
  const { Hono } = await import('hono')
  const { mountPdsGate } = await import('../src/pdsGate.ts')
  const jwt = (scope: string) => `h.${Buffer.from(JSON.stringify({ scope })).toString('base64url')}.s`
  const deleted: string[] = []
  const realFetch = globalThis.fetch
  globalThis.fetch = (async (url: URL | string, init?: RequestInit) => {
    const { identifier, password } = JSON.parse(String(init?.body)) as { identifier: string; password: string }
    const did = identifier === 'totp' ? 'did:plc:totp' : 'did:plc:plain'
    const scope = password.startsWith('app-') ? 'com.atproto.appPass' : 'com.atproto.access'
    return new Response(JSON.stringify({ did, accessJwt: jwt(scope), refreshJwt: `ref-${identifier}` }), { status: 200, headers: { 'content-type': 'application/json' } })
  }) as typeof fetch
  try {
    const app = new Hono()
    mountPdsGate(app, {
      pdsUrl: 'http://pds.test',
      pds: { deleteSession: async (t: string) => void deleted.push(t) } as unknown as PdsClient,
      mfa: { get: async (did: string) => ({ totpEnabledAt: did === 'did:plc:totp' ? new Date() : null }) } as unknown as MfaRepo,
    })
    const login = (identifier: string, password: string) =>
      app.request('/pds/createSession', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ identifier, password }) })
    const blocked = await login('totp', 'main-pass')
    assert.equal(blocked.status, 401)
    assert.equal((await blocked.json()).error, 'AuthFactorTokenRequired')
    assert.deepEqual(deleted, ['ref-totp'], 'выданная PDS полная сессия сразу отозвана')
    assert.equal((await login('totp', 'app-xxxx-xxxx')).status, 200, 'пароль приложения работает')
    assert.equal((await login('plain', 'main-pass')).status, 200, 'без TOTP — как обычно')
  } finally {
    globalThis.fetch = realFetch
  }
})

test('pds gate: account from the other contour — local PDS 401, peer gate logs in; peer TOTP refusal passed through; no loops', async () => {
  const { Hono } = await import('hono')
  const { mountPdsGate } = await import('../src/pdsGate.ts')
  const calls: string[] = []
  const realFetch = globalThis.fetch
  globalThis.fetch = (async (url: URL | string, init?: RequestInit) => {
    const u = String(url)
    calls.push(u)
    const { identifier } = JSON.parse(String(init?.body)) as { identifier: string }
    const send = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
    if (u.startsWith('http://pds.test')) return send(401, { error: 'AuthenticationRequired', message: 'Invalid identifier or password' })
    assert.equal(new Headers(init?.headers).get('x-indie-peer-hop'), '1', 'сосед получает метку перехода')
    if (identifier === 'ru-user.weat.media') return send(200, { did: 'did:plc:ru', accessJwt: 'a', refreshJwt: 'r', didDoc: {} })
    if (identifier === 'ru-totp.weat.media') return send(401, { error: 'AuthFactorTokenRequired', message: 'TOTP' })
    return send(401, { error: 'AuthenticationRequired' })
  }) as typeof fetch
  try {
    const app = new Hono()
    mountPdsGate(app, {
      pdsUrl: 'http://pds.test',
      pds: {} as unknown as PdsClient,
      mfa: { get: async () => ({ totpEnabledAt: null }) } as unknown as MfaRepo,
      peer: { publicUrl: 'http://peer.test' } as unknown as PeerContour,
    })
    const login = (identifier: string, hop = false) =>
      app.request('/pds/createSession', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(hop ? { 'x-indie-peer-hop': '1' } : {}) },
        body: JSON.stringify({ identifier, password: 'pw' }),
      })
    const ok = await login('ru-user.weat.media')
    assert.equal(ok.status, 200)
    assert.equal((await ok.json()).did, 'did:plc:ru')
    assert.equal((await (await login('ru-totp.weat.media')).json()).error, 'AuthFactorTokenRequired')
    assert.equal((await login('nobody.weat.media')).status, 401)
    calls.length = 0
    assert.equal((await login('ru-user.weat.media', true)).status, 401, 'запрос от соседа дальше не идёт')
    assert.deepEqual(calls, ['http://pds.test/xrpc/com.atproto.server.createSession'])
  } finally {
    globalThis.fetch = realFetch
  }
})

test('pds oauth sign-in gate: TOTP account refused whatever the password; others forwarded to PDS with headers and cookies intact; peer asked for foreign DIDs', async () => {
  const { Hono } = await import('hono')
  const { mountPdsGate } = await import('../src/pdsGate.ts')
  const forwarded: { url: string; headers: Headers; body: string }[] = []
  const realFetch = globalThis.fetch
  globalThis.fetch = (async (url: URL | string, init?: RequestInit) => {
    const u = String(url)
    if (u.startsWith('http://peer.test/api/peer/totp')) return new Response(JSON.stringify({ totp: new URL(u).searchParams.get('did') === 'did:plc:ru-totp' }), { status: 200 })
    forwarded.push({ url: u, headers: new Headers(init?.headers), body: String(init?.body) })
    const h = new Headers({ 'content-type': 'application/json' })
    h.append('set-cookie', 'device-id=abc; Path=/; HttpOnly')
    h.append('set-cookie', 'session-id=def; Path=/; HttpOnly')
    return new Response(JSON.stringify({ account: { sub: 'did:plc:plain' } }), { status: 200, headers: h })
  }) as typeof fetch
  try {
    const app = new Hono()
    const dids: Record<string, string> = { 'totp.weat.media': 'did:plc:totp', 'plain.weat.media': 'did:plc:plain', 'plain@example.com': 'did:plc:plain', 'ru-totp.weat.media': 'did:plc:ru-totp', 'ru-plain.weat.media': 'did:plc:ru-plain' }
    mountPdsGate(app, {
      pdsUrl: 'http://pds.test',
      pds: { didForIdentifier: async (id: string) => dids[id] } as unknown as PdsClient,
      mfa: { get: async (did: string) => ({ totpEnabledAt: did === 'did:plc:totp' ? new Date() : null }) } as unknown as MfaRepo,
      users: { findByDid: async (did: string) => (did.startsWith('did:plc:ru-') ? undefined : { did }) } as unknown as UserRepo,
      peer: { publicUrl: 'http://peer.test' } as unknown as PeerContour,
      peerSecret: 'x'.repeat(32),
    })
    const signIn = (identifier: string, password = 'pw') =>
      app.request('/pds/oauth-sign-in', {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'https://pds.weat.media', 'x-csrf-token': 't0k', cookie: 'csrf-token=t0k' },
        body: JSON.stringify({ locale: 'ru', identifier, password }),
      })
    for (const pw of ['right', 'wrong']) {
      const r = await signIn('totp.weat.media', pw)
      assert.equal(r.status, 400)
      assert.equal((await r.json()).error, 'invalid_request')
    }
    assert.equal((await signIn('ru-totp.weat.media')).status, 400, 'TOTP у пользователя соседнего контура')
    assert.equal(forwarded.length, 0, 'до PDS не дошло')

    const ok = await signIn('plain.weat.media')
    assert.equal(ok.status, 200)
    assert.deepEqual(ok.headers.getSetCookie(), ['device-id=abc; Path=/; HttpOnly', 'session-id=def; Path=/; HttpOnly'])
    assert.equal(forwarded[0]!.url, 'http://pds.test/@atproto/oauth-provider/~api/sign-in')
    assert.equal(forwarded[0]!.headers.get('origin'), 'https://pds.weat.media')
    assert.equal(forwarded[0]!.headers.get('x-csrf-token'), 't0k')
    assert.equal(forwarded[0]!.headers.get('cookie'), 'csrf-token=t0k')
    assert.equal(JSON.parse(forwarded[0]!.body).password, 'pw')
    assert.equal((await signIn('plain@example.com')).status, 200, 'вход по email')
    assert.equal((await signIn('ru-plain.weat.media')).status, 200)
    assert.equal((await signIn('nobody.weat.media')).status, 200, 'неизвестный — пусть ответит PDS')
  } finally {
    globalThis.fetch = realFetch
  }
})

test('feed stream (SSE): index events relayed through one upstream, restricted dropped, cooldown article announced as pending', async () => {
  const { createServer } = await import('node:http')
  let upstreamConnections = 0
  let push: ((event: string, data: unknown) => void) | null = null
  const feed = createServer((req, res) => {
    if (req.url !== '/feed-api/stream') return void res.writeHead(404).end()
    upstreamConnections++
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    push = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
  })
  await new Promise<void>((r) => feed.listen(0, '127.0.0.1', r))
  const port = (feed.address() as { port: number }).port
  const bad = 'at://did:plc:x/media.weat.article/bad'
  const app = makeApp({ feedUrl: `http://127.0.0.1:${port}`, cooldown: true, ipCountry: { '5.1.1.1': 'DE' }, restricted: { enabled: true, async blocked(uris: string[]) { return new Set(uris.filter((u) => u === bad)) } } as Deps['restricted'] })
  const open = async () => {
    const ctrl = new AbortController()
    const res = await app.request('/api/feed/stream', { signal: ctrl.signal })
    assert.equal(res.status, 200)
    assert.match(res.headers.get('content-type') ?? '', /text\/event-stream/)
    const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader()
    let buf = ''
    const next = async (name: string) => {
      for (;;) {
        const m = new RegExp(`event: ${name}\\ndata: (.*)\\n`).exec(buf)
        if (m) {
          buf = buf.slice(m.index + m[0].length)
          return JSON.parse(m[1]!) as Record<string, unknown>
        }
        const { value, done } = await reader.read()
        if (done) throw new Error('stream closed')
        buf += value
      }
    }
    return { next, close: async () => { await reader.cancel(); ctrl.abort() } }
  }
  try {
    const a = await open()
    const b = await open()
    await a.next('ready')
    await b.next('ready')
    for (let i = 0; i < 50 && !push; i++) await new Promise((r) => setTimeout(r, 10))
    assert.equal(upstreamConnections, 1, 'одно соединение с лентой на всех слушателей')

    push!('created', { type: 'created', uri: bad, did: 'did:plc:x', id: 'bad-plc:x', title: 'Закрытая', at: 'now' })
    push!('created', { type: 'created', uri: 'at://did:plc:x/media.weat.article/ok', did: 'did:plc:x', id: 'ok-plc:x', title: 'Открытая', at: 'now' })
    assert.equal((await a.next('created')).title, 'Открытая', 'закрытая метками в РФ не рассылается')
    assert.equal((await b.next('created')).title, 'Открытая')
    push!('deleted', { type: 'deleted', uri: bad, did: 'did:plc:x', id: 'bad-plc:x', at: 'now' })
    assert.equal((await a.next('deleted')).uri, bad, 'удаление — всегда')

    // статья на охлаждении: видна на сайте сразу — событие pending
    const u = await (await app.request('/api/auth/register', json({ ...reg, username: 'livewriter', email: 'live@example.com' }, '5.1.1.1'))).json()
    const pub = await (await app.request('/api/me/articles', { method: 'POST', headers: { authorization: `Bearer ${u.accessJwt}`, 'content-type': 'application/json' }, body: JSON.stringify({ title: 'Свежая', text: 'текст' }) })).json()
    const ev = await a.next('created')
    assert.equal(ev.uri, pub.uri)
    assert.equal(ev.pending, true)
    assert.equal(ev.title, 'Свежая')
    assert.equal(ev.id, `${pub.uri.split('/').pop()}-${u.user.did.slice(-6)}`)
    await a.close()
    await b.close()
  } finally {
    feed.closeAllConnections()
    feed.close()
  }
})

test('RU contour: feed asks the index for own articles only (origin=weat); other platforms are empty', async () => {
  const asked: string[] = []
  const realFetch = globalThis.fetch
  globalThis.fetch = (async (url: URL | string, init?: RequestInit) => {
    const u = String(url)
    if (u.startsWith('http://feed.test/')) {
      asked.push(u)
      return new Response(JSON.stringify({ articles: [] }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    return realFetch(url, init)
  }) as typeof fetch
  try {
    const ru = makeApp({ feedUrl: 'http://feed.test', restricted: { enabled: true, async blocked() { return new Set<string>() } } as Deps['restricted'] })
    await ru.request('/api/feed?origin=all&limit=10')
    assert.equal(new URL(asked.at(-1)!).searchParams.get('origin'), 'weat')
    const ext = await (await ru.request('/api/feed?origin=standard')).json()
    assert.deepEqual(ext.articles, [])
    const global = makeApp({ feedUrl: 'http://feed.test' })
    await global.request('/api/feed?origin=all&limit=10')
    assert.equal(new URL(asked.at(-1)!).searchParams.get('origin'), 'all', 'глобальный контур — как просили')
  } finally {
    globalThis.fetch = realFetch
  }
})

test('system accounts: admin creates news (reserved handle via admin API), logs in via handoff; people cannot be impersonated', async () => {
  const app = makeApp({ ipCountry: { '5.1.1.1': 'DE' } })
  const admin = { authorization: `Bearer ${await staffToken(['admin'])}`, 'content-type': 'application/json' }
  const support = { authorization: `Bearer ${await staffToken(['support'])}`, 'content-type': 'application/json' }
  const create = (b: unknown, h = admin) => app.request('/api/admin/system-accounts', { method: 'POST', headers: h, body: JSON.stringify(b) })
  assert.equal((await create({ username: 'news', displayName: 'Новости' }, support)).status, 403)
  assert.equal((await create({ username: 'N!', displayName: 'x' })).status, 400)
  const res = await create({ username: 'news', displayName: 'Новости weAT.media', description: 'Обновления и новые функции' })
  assert.equal(res.status, 201)
  const news = await res.json()
  assert.equal(news.handle, 'news.indie.media')
  assert.equal((await create({ username: 'news', displayName: 'дубль' })).status, 409)
  const list = await (await app.request('/api/admin/system-accounts', { headers: admin })).json()
  assert.equal(list[0].service, 'system')
  assert.equal(list[0].canLogin, true)

  const login = await (await app.request(`/api/admin/system-accounts/${news.did}/login`, { method: 'POST', headers: admin })).json()
  const s = await (await app.request('/api/auth/handoff', json({ code: login.code }, '5.1.1.1'))).json()
  assert.equal(s.user.did, news.did, 'обычная сессия системной учётки')
  const human = await (await app.request('/api/auth/register', json({ ...reg, username: 'human', email: 'h@example.com' }, '5.1.1.1'))).json()
  assert.equal((await app.request(`/api/admin/system-accounts/${human.user.did}/login`, { method: 'POST', headers: admin })).status, 404, 'в человека войти нельзя')
  assert.ok(auditLog.some((e) => e.action === 'system.login' && e.target === news.did))
})

test('ru contour: articles labeled by nsfw/politics are cut from feed, related, article page and RSS', async () => {
  const { filterRssItems, rssGuids } = await import('../src/restricted.ts')
  const bad = 'at://did:plc:a/media.weat.article/bad'
  const ok = 'at://did:plc:a/media.weat.article/ok'
  const restricted = { enabled: true, async blocked(uris: string[]) { return new Set(uris.filter((u) => u === bad)) } }
  const app = makeApp({ contour: 'ru', restricted, feedUrl: 'http://feed.test' })
  const realFetch = globalThis.fetch
  globalThis.fetch = (async (url: URL | string) => {
    const u = String(url)
    if (u.includes('/feed-api/articles') || u.includes('/feed-api/related')) return Response.json({ articles: [{ uri: bad }, { uri: ok }], cursor: null })
    if (u.includes('/rss/')) return new Response(`<rss><channel>\n<item>\n<guid isPermaLink="false">${bad}</guid>\n</item>\n<item>\n<guid isPermaLink="false">${ok}</guid>\n</item>\n</channel></rss>`, { headers: { 'content-type': 'application/rss+xml' } })
    return Response.json({ uri: ok, record: {} })
  }) as typeof fetch
  try {
    assert.deepEqual((await (await app.request('/api/feed')).json()).articles.map((a: { uri: string }) => a.uri), [ok])
    assert.deepEqual((await (await app.request(`/api/feed/related?uri=${encodeURIComponent(ok)}`)).json()).articles.map((a: { uri: string }) => a.uri), [ok])
    assert.equal((await app.request(`/api/feed/article?uri=${encodeURIComponent(bad)}`)).status, 451)
    const rss = await (await app.request('/api/rss/author/a.indie.media')).text()
    assert.ok(!rss.includes(bad) && rss.includes(ok))
    assert.deepEqual((await (await app.request('/api/geo')).json()).hiddenCollegia, ['nsfw', 'politics'])
  } finally {
    globalThis.fetch = realFetch
  }
  assert.equal(filterRssItems('<item><guid>x</guid></item>', new Set()), '<item><guid>x</guid></item>')
  assert.deepEqual(rssGuids('<guid a="1">at://u</guid>'), ['at://u'])
})

test('profile: change name, about and avatar on the site; image type by signature, 1 MB limit; public profile shows avatar', async () => {
  const app = makeApp({ ipCountry: { '5.1.1.1': 'DE' } })
  const u = await (await app.request('/api/auth/register', json({ ...reg, username: 'pic', email: 'pic@example.com' }, '5.1.1.1'))).json()
  const auth = { authorization: `Bearer ${u.accessJwt}` }
  const p = await app.request('/api/me/profile', { method: 'PATCH', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ displayName: 'Алина', description: 'Пишу про AT' }) })
  assert.deepEqual(await p.json(), { did: u.user.did, displayName: 'Алина', description: 'Пишу про AT', avatar: null })
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])
  const up = await app.request('/api/me/avatar', { method: 'POST', headers: { ...auth, 'content-type': 'image/png' }, body: png })
  assert.equal(up.status, 200)
  assert.equal((await up.json()).avatar, 'bafyavatar11')
  const fake = await app.request('/api/me/avatar', { method: 'POST', headers: { ...auth, 'content-type': 'image/png' }, body: new TextEncoder().encode('<svg onload=alert(1)>') })
  assert.equal(fake.status, 415, 'не картинка по сигнатуре')
  const big = new Uint8Array(1_000_001); big.set([0xff, 0xd8, 0xff])
  assert.equal((await app.request('/api/me/avatar', { method: 'POST', headers: { ...auth, 'content-type': 'image/jpeg' }, body: big })).status, 413)
  const pub = await (await app.request(`/api/users/${u.user.handle}`)).json()
  assert.equal(pub.displayName, 'Алина')
  assert.equal(pub.avatar, 'bafyavatar11')
  assert.equal((await (await app.request('/api/me/avatar', { method: 'DELETE', headers: auth })).json()).avatar, null)
  assert.equal((await app.request('/api/me/avatar', { method: 'POST', body: png })).status, 401)
})

test('editor images: uploaded file is available from the permanent AppView mirror', async () => {
  const app = makeApp({ ipCountry: { '5.1.1.1': 'DE' } })
  const u = await (await app.request('/api/auth/register', json({ ...reg, username: 'editorimg', email: 'editorimg@example.com' }, '5.1.1.1'))).json()
  const res = await app.request('/api/me/images', { method: 'POST', headers: { authorization: `Bearer ${u.accessJwt}`, 'content-type': 'image/webp' }, body: new Uint8Array([1, 2, 3, 4]) })
  assert.equal(res.status, 200)
  assert.deepEqual(await res.json(), { url: 'http://localhost:3000/api/editor-images/bafyavatar4' })
  const image = await app.request('/api/editor-images/bafyavatar4')
  assert.equal(image.status, 200)
  assert.equal(image.headers.get('content-type'), 'image/webp')
  assert.deepEqual(new Uint8Array(await image.arrayBuffer()), new Uint8Array([1, 2, 3, 4]))
  assert.equal((await app.request('/api/editor-images/missing')).status, 404)
  assert.equal((await app.request('/api/me/images', { method: 'POST', headers: { authorization: `Bearer ${u.accessJwt}`, 'content-type': 'text/plain' }, body: 'no' })).status, 415)
  assert.equal((await app.request('/api/me/images', { method: 'POST', headers: { 'content-type': 'image/webp' }, body: new Uint8Array([1]) })).status, 401)
})

test('admin users: search by part of handle or name, @ prefix ok', async () => {
  const app = makeApp({ ipCountry: { '5.1.1.1': 'DE' } })
  await app.request('/api/auth/register', json({ ...reg, username: 'vitali-haradkou', email: 'v@example.com' }, '5.1.1.1'))
  const support = { authorization: `Bearer ${await staffToken(['support'])}` }
  const find = async (q: string) => (await (await app.request(`/api/admin/users?${new URLSearchParams({ q })}`, { headers: support })).json()).map((u: { handle: string }) => u.handle)
  assert.deepEqual(await find('harad'), ['vitali-haradkou.indie.media'], 'середина handle')
  assert.deepEqual(await find('@VITALI'), ['vitali-haradkou.indie.media'], 'регистр и @')
  assert.deepEqual(await find('nobody'), [])
})

test('drafts: create, autosave, list, others cannot read; mention search finds users', async () => {
  const app = makeApp({ ipCountry: { '5.1.1.1': 'DE' } })
  const a = await (await app.request('/api/auth/register', json({ ...reg, username: 'drafter', email: 'd@example.com' }, '5.1.1.1'))).json()
  const b = await (await app.request('/api/auth/register', json({ ...reg, username: 'other', email: 'o@example.com' }, '5.1.1.1'))).json()
  const A = { authorization: `Bearer ${a.accessJwt}`, 'content-type': 'application/json' }
  const created = await (await app.request('/api/me/drafts', { method: 'POST', headers: A, body: JSON.stringify({ title: 'Черновик', text: '# Черновик\n\nпервый абзац' }) })).json()
  assert.match(created.id, /^dr_/)
  await app.request(`/api/me/drafts/${created.id}`, { method: 'PUT', headers: A, body: JSON.stringify({ title: 'Черновик 2', text: 'обновлён' }) })
  const list = await (await app.request('/api/me/drafts', { headers: A })).json()
  assert.deepEqual(list.drafts.map((x: { title: string; excerpt: string }) => [x.title, x.excerpt]), [['Черновик 2', 'обновлён']])
  assert.equal((await app.request(`/api/me/drafts/${created.id}`, { headers: { authorization: `Bearer ${b.accessJwt}` } })).status, 404, 'чужой не видно')
  // настройки шага 2 сохраняются вместе с черновиком; сохранение без meta их не стирает
  await app.request(`/api/me/drafts/${created.id}`, { method: 'PUT', headers: A, body: JSON.stringify({ title: 'Черновик 2', text: 'обновлён', meta: { subtitle: 'Подзаголовок', tags: ['ai'] } }) })
  await app.request(`/api/me/drafts/${created.id}`, { method: 'PUT', headers: A, body: JSON.stringify({ title: 'Черновик 2', text: 'ещё' }) })
  assert.deepEqual((await (await app.request(`/api/me/drafts/${created.id}`, { headers: A })).json()).meta, { subtitle: 'Подзаголовок', tags: ['ai'] })
  assert.equal((await app.request(`/api/me/drafts/${created.id}`, { method: 'DELETE', headers: A })).status, 200)
  const found = await (await app.request('/api/users/search?q=draf')).json()
  assert.deepEqual(found.users.map((u: { handle: string }) => u.handle), ['drafter.indie.media'])
})

test('collections: persist publicly, migrate by stable id, only owner can update', async () => {
  const app = makeApp({ ipCountry: { '5.1.1.1': 'DE' } })
  const a = await (await app.request('/api/auth/register', json({ ...reg, username: 'collector', email: 'collector@example.com' }, '5.1.1.1'))).json()
  const b = await (await app.request('/api/auth/register', json({ ...reg, username: 'reader', email: 'reader@example.com' }, '5.1.1.1'))).json()
  const auth = (token: string) => ({ authorization: `Bearer ${token}`, 'content-type': 'application/json' })
  const body = { id: 'u-col-local1', title: 'Курс по AT Protocol', description: 'От PDS к AppView', articleIds: ['article-1'] }
  const created = await app.request('/api/me/collections', { method: 'POST', headers: auth(a.accessJwt), body: JSON.stringify(body) })
  assert.equal(created.status, 201)
  assert.equal((await created.json()).authorHandle, a.user.handle)
  const repeated = await app.request('/api/me/collections', { method: 'POST', headers: auth(a.accessJwt), body: JSON.stringify(body) })
  assert.equal(repeated.status, 201)
  const mine = await (await app.request('/api/me/collections', { headers: auth(a.accessJwt) })).json()
  assert.equal(mine.collections.length, 1, 'миграция не создаёт дубль')
  assert.deepEqual(mine.collections[0].articleIds, ['article-1'])
  const updated = await app.request('/api/me/collections/u-col-local1', { method: 'PUT', headers: auth(a.accessJwt), body: JSON.stringify({ ...body, articleIds: ['article-1', 'article-2', 'article-1'] }) })
  assert.deepEqual((await updated.json()).articleIds, ['article-1', 'article-2'])
  const foreign = await app.request('/api/me/collections/u-col-local1', { method: 'PUT', headers: auth(b.accessJwt), body: JSON.stringify({ ...body, title: 'Чужая правка' }) })
  assert.equal(foreign.status, 404)
  const publicList = await (await app.request('/api/collections')).json()
  assert.equal(publicList.collections[0].title, 'Курс по AT Protocol')
  const publicItem = await (await app.request('/api/collections/u-col-local1')).json()
  assert.deepEqual(publicItem.articleIds, ['article-1', 'article-2'])
  assert.equal((await app.request('/api/collections', { method: 'POST', body: JSON.stringify(body) })).status, 404)
  assert.equal((await app.request('/api/me/collections')).status, 401)
  assert.equal((await app.request('/api/me/collections/u-col-local1', { method: 'DELETE', headers: auth(b.accessJwt) })).status, 404, 'чужую подборку нельзя удалить')
  assert.equal((await app.request('/api/me/collections/u-col-local1', { method: 'DELETE', headers: auth(a.accessJwt) })).status, 200)
  assert.equal((await app.request('/api/collections/u-col-local1')).status, 404)
})

test('admin profile edit: service account — repo profile; human — only site name; audited', async () => {
  const app = makeApp({ ipCountry: { '5.1.1.1': 'DE' } })
  const admin = { authorization: `Bearer ${await staffToken(['admin'])}`, 'content-type': 'application/json' }
  const support = { authorization: `Bearer ${await staffToken(['support'])}`, 'content-type': 'application/json' }
  const news = await (await app.request('/api/admin/system-accounts', { method: 'POST', headers: admin, body: JSON.stringify({ username: 'news', displayName: 'Новости' }) })).json()
  const edit = (did: string, b: unknown, h = admin) => app.request(`/api/admin/users/${did}/profile`, { method: 'PUT', headers: h, body: JSON.stringify(b) })
  assert.equal((await edit(news.did, { displayName: 'X' }, support)).status, 403)
  const r = await (await edit(news.did, { displayName: 'Новости площадки', description: 'Обновления' })).json()
  assert.equal(r.scope, 'repo')
  assert.equal(r.displayName, 'Новости площадки')
  const human = await (await app.request('/api/auth/register', json({ ...reg, username: 'rude', email: 'r@example.com' }, '5.1.1.1'))).json()
  assert.equal((await edit(human.user.did, { description: 'x' })).status, 400, 'описание человека не меняем')
  const h = await (await edit(human.user.did, { displayName: 'Пользователь', reason: 'оскорбительное имя' })).json()
  assert.equal(h.scope, 'site')
  assert.equal(h.displayName, 'Пользователь')
  assert.ok(auditLog.some((e) => e.action === 'user.profile' && e.target === human.user.did))
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
  assert.equal((await post('/api/me/2fa/totp/enable', { password: 'wrong-password', code: now() })).status, 401, 'одной украденной сессии недостаточно: нужен пароль')
  assert.equal((await post('/api/me/2fa/totp/enable', { password: 'correct-horse', code: '000000' === now() ? '111111' : '000000' })).status, 400)
  const en = await (await post('/api/me/2fa/totp/enable', { password: 'correct-horse', code: now() })).json()
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

test('authenticated password change with email code requires confirmed email and valid code', async () => {
  const app = makeApp()
  const { accessJwt, user } = await registerWithPassword(app, '1.1.1.1')
  const auth = { authorization: `Bearer ${accessJwt}`, 'content-type': 'application/json' }
  const post = (path: string, body: unknown) => app.request(path, { method: 'POST', headers: auth, body: JSON.stringify(body) })
  assert.equal((await post('/api/me/password/email/request', {})).status, 400, 'email ещё не подтверждён')
  await post('/api/me/email/confirm/request', {})
  assert.equal((await post('/api/me/email/confirm', { code: 'CONF-1' })).status, 200)
  assert.equal((await post('/api/me/password/email/request', {})).status, 200)
  const bad = await post('/api/me/password/change', { method: 'email', code: 'RESET-wrong', password: 'new-password-2' })
  assert.equal(bad.status, 401)
  const ok = await post('/api/me/password/change', { method: 'email', code: mailbox.reset, password: 'new-password-2' })
  assert.equal(ok.status, 200)
  const login = await fakePdsLast!.createSession('alina.indie.media', 'new-password-2', 'TWOFA-1')
  assert.equal(login.did, user.did)
  assert.equal((await app.request('/api/me/password/change', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ method: 'email', code: mailbox.reset, password: 'attacker-password' }) })).status, 401)
})

test('provider-only user sets AT password in settings: provider login keeps working, wrong code leaves account passwordless', async () => {
  const app = makeApp({ ipCountry: { '95.1.1.1': 'RU' } })
  const ya = await oauthFlow(app, 'yandex', 'code-ivan', '95.1.1.1')
  const s = await (await app.request('/api/auth/handoff', json({ code: ya.searchParams.get('handoff') }, '95.1.1.1'))).json()
  const auth = { authorization: `Bearer ${s.accessJwt}`, 'content-type': 'application/json' }
  const post = (path: string, body: unknown) => app.request(path, { method: 'POST', headers: auth, body: JSON.stringify(body) })
  await post('/api/me/email/confirm/request', {})
  assert.equal((await post('/api/me/email/confirm', { code: 'CONF-1' })).status, 200)
  assert.equal((await post('/api/me/password/email/request', {})).status, 200)

  assert.equal((await post('/api/me/password/change', { method: 'email', code: 'RESET-wrong', password: 'my-at-password' })).status, 401)
  assert.equal((await getIds(app, s.accessJwt)).passwordLogin, false, 'неверный код — пароля по-прежнему нет')

  assert.equal((await post('/api/me/password/change', { method: 'email', code: mailbox.reset, password: 'my-at-password' })).status, 200)
  assert.equal((await getIds(app, s.accessJwt)).passwordLogin, true)
  // теперь можно войти в Bluesky и другие AT-приложения: handle + новый пароль
  assert.equal((await fakePdsLast!.createSession('ivan-petrov.indie.media', 'my-at-password', 'TWOFA-1')).did, s.user.did)
  // а вход через Яндекс не сломался: в привязке теперь пароль приложения, а не старый основной
  const again = await oauthFlow(app, 'yandex', 'code-ivan', '95.1.1.1')
  const s2 = await (await app.request('/api/auth/handoff', json({ code: again.searchParams.get('handoff') }, '95.1.1.1'))).json()
  assert.equal(s2.user.handle, 'ivan-petrov.indie.media')
})

test('authenticated password change with TOTP uses one-time second factor', async () => {
  const app = makeApp()
  const { accessJwt, user } = await registerWithPassword(app, '1.1.1.1')
  const auth = { authorization: `Bearer ${accessJwt}`, 'content-type': 'application/json' }
  const post = (path: string, body: unknown) => app.request(path, { method: 'POST', headers: auth, body: JSON.stringify(body) })
  const { secret } = await (await post('/api/me/2fa/totp/setup', {})).json()
  const current = totpCode(secret, Math.floor(Date.now() / 30_000))
  assert.equal((await post('/api/me/2fa/totp/enable', { password: 'correct-horse', code: current })).status, 200)
  const next = totpCode(secret, Math.floor(Date.now() / 30_000) + 1)
  const bad = await post('/api/me/password/change', { method: 'totp', code: current, password: 'new-password-3' })
  assert.equal(bad.status, 401, 'шаг TOTP нельзя переиспользовать')
  const ok = await post('/api/me/password/change', { method: 'totp', code: next, password: 'new-password-3' })
  assert.equal(ok.status, 200)
  const login = await fakePdsLast!.createSession('alina.indie.media', 'new-password-3')
  assert.equal(login.did, user.did)
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
  async profile(id: string) {
    const did = known[id]
    return did ? { did, handle: id, displayName: 'Сосед', createdAt: '2026-01-01T00:00:00.000Z', service: id.startsWith('news.') ? 'system' : null } : null
  },
})

test('contours: profile of a peer-contour account is shown live; only public fields cross; peer endpoint needs hop header', async () => {
  const app = makeApp({ peer: fakePeer({ 'news.indie.media': 'did:plc:news' }), ipCountry: { '5.1.1.1': 'DE' } })
  const p = await (await app.request('/api/users/news.indie.media')).json()
  assert.equal(p.did, 'did:plc:news')
  assert.equal(p.contour, 'peer')
  assert.equal(p.service, 'system')
  const local = await (await app.request('/api/auth/register', json({ ...reg, username: 'local', email: 'local@example.com' }, '5.1.1.1'))).json()
  assert.equal((await app.request(`/api/peer/users/${local.user.handle}`)).status, 404, 'без hop-заголовка — не отдаём')
  const out = await (await app.request(`/api/peer/users/${local.user.handle}`, { headers: { 'x-indie-peer-hop': '1' } })).json()
  assert.deepEqual(Object.keys(out).sort(), ['createdAt', 'did', 'displayName', 'handle', 'service'], 'через границу — без email, стран, тарифа')
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

  // черновик токеном: в репозиторий не пишется, автор видит его в своих черновиках
  const before = published.length
  const dr = await app.request('/api/v1/drafts', { method: 'POST', headers: auth(tok.token), body: JSON.stringify({ title: 'Перенос с Хабра', text: 'Текст **статьи**', tags: ['habr'], langs: ['ru'] }) })
  assert.equal(dr.status, 201)
  const draft = await dr.json()
  assert.equal(draft.editUrl, `/compose?draft=${draft.id}`)
  assert.equal(published.length, before, 'черновик не публикуется')
  const mine = await (await app.request(`/api/me/drafts/${draft.id}`, { headers: auth(author.accessJwt) })).json()
  assert.equal(mine.text, '# Перенос с Хабра\n\nТекст **статьи**')
  assert.deepEqual(mine.meta, { tags: ['habr'], language: 'ru' })

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
  const before = pdsDeleted.length
  const r = await (await app.request('/api/me/sessions/revoke-others', { method: 'POST', headers: auth(u.accessJwt) })).json()
  assert.ok(pdsDeleted.length > before, 'отозванная сессия отозвана и в PDS (deleteSession)')
  assert.ok(pdsDeleted.slice(before).every((t) => t.startsWith('ref-')), 'в PDS ушёл расшифрованный refresh')
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
  assert.ok(auditLog.some((e) => e.action === 'payment.refund_unmatched'), 'несопоставленный возврат — в журнал')
  // возврат с id контракта: доступ гаснет, заказ — refunded
  assert.equal((await hook({ event_type: 'refund.success', data: { contract_id: contractId, refund_type: 'full' } })).status, 200)
  assert.equal((await read()).status, 402, 'после возврата статья снова закрыта')
  assert.equal((await (await app.request(`/api/me/purchases/${orderId}`, { headers: auth(reader.accessJwt) })).json()).status, 'refunded')
  assert.ok(auditLog.some((e) => e.action === 'payment.refund' && e.target === orderId))
})

test('username taken: register and check suggest a free name-N; user can change handle later', async () => {
  const app = makeApp()
  const auth = (t: string) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' })
  const reg1 = (u: string, email: string) => app.request('/api/auth/register', json({ ...reg, username: u, email }, '1.1.1.1'))
  const a = await (await reg1('takenname', 'tn1@example.com')).json()
  const dup = await reg1('takenname', 'tn2@example.com')
  assert.equal(dup.status, 409)
  assert.equal((await dup.json()).suggestion, 'takenname-2')
  assert.deepEqual(await (await app.request('/api/auth/username/takenname')).json(), { available: false, suggestion: 'takenname-2' })
  assert.deepEqual(await (await app.request('/api/auth/username/freename')).json(), { available: true })
  const b = await (await reg1('takenname-2', 'tn2@example.com')).json()
  // b меняет ник на свой: занятый — 409 с подсказкой, свободный — новый handle
  const busy = await app.request('/api/me/handle', { method: 'PUT', headers: auth(b.accessJwt), body: JSON.stringify({ username: 'takenname' }) })
  assert.equal(busy.status, 409)
  assert.equal((await busy.json()).suggestion, 'takenname-3')
  const ok = await app.request('/api/me/handle', { method: 'PUT', headers: auth(b.accessJwt), body: JSON.stringify({ username: 'mynewname' }) })
  assert.equal(ok.status, 200, await ok.clone().text())
  assert.match((await (await app.request('/api/me', { headers: auth(b.accessJwt) })).json()).handle, /^mynewname\./)
  void a
})

test('lava.top: Premium for 30 days — invoice, webhook turns it on, renewal adds days, refund turns it off', async () => {
  const app = makeApp()
  const auth = (t: string) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' })
  const u = await (await app.request('/api/auth/register', json({ ...reg, username: 'buyprem', email: 'buyprem@example.com' }, '1.1.1.1'))).json()
  const me = async () => (await (await app.request('/api/me', { headers: auth(u.accessJwt) })).json()).tier
  const hook = (body: unknown) =>
    app.request('/api/webhooks/payment', { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': 'lava-webhook-secret-0123' }, body: JSON.stringify(body) })
  const buy = async () => {
    const r = await app.request('/api/me/premium', { method: 'POST', headers: auth(u.accessJwt), body: '{}' })
    assert.equal(r.status, 201, await r.clone().text())
    const { orderId } = await r.json()
    assert.equal(lavaRequests.at(-1)!.amount, 299)
    const contractId = [...lavaInvoices.keys()].at(-1)!
    lavaInvoices.set(contractId, { id: contractId, status: 'COMPLETED', receipt: { amount: 299, currency: 'RUB' } })
    assert.equal((await hook({ eventType: 'payment.success', contractId, amount: 299, currency: 'RUB' })).status, 200)
    return { orderId, contractId }
  }
  assert.equal(await me(), 'free')
  const first = await buy()
  assert.equal(await me(), 'premium')
  const o1 = await (await app.request(`/api/me/purchases/${first.orderId}`, { headers: auth(u.accessJwt) })).json()
  assert.equal(o1.status, 'paid')
  assert.equal(o1.kind, 'premium')
  const second = await buy()
  const o2 = await (await app.request(`/api/me/purchases/${second.orderId}`, { headers: auth(u.accessJwt) })).json()
  assert.ok(new Date(o2.paidUntil).getTime() - new Date(o1.paidUntil).getTime() >= 29 * 86_400_000, 'продление прибавляет срок')
  // возврат одного из двух: второй срок ещё действует
  await hook({ event_type: 'refund.success', data: { contract_id: first.contractId } })
  assert.equal(await me(), 'premium')
  await hook({ event_type: 'refund.success', data: { contract_id: second.contractId } })
  assert.equal(await me(), 'free')
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
  const otherProjectAdmin = await new SignJWT({ 'urn:zitadel:iam:org:project:roles': { admin: { other: 'other-project' } } })
    .setProtectedHeader({ alg: 'RS256', kid: 'k1' }).setIssuer(ZITADEL).setAudience(PROJECT_ID).setSubject('u-other').setIssuedAt().setExpirationTime('5m').sign(zKeys.privateKey)
  assert.equal((await tier(otherProjectAdmin)).status, 403, 'generic claim с ролью другого проекта не даёт прав')

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

  // перенос — сессией автора: статьи этого автора у краулера копируются ему, оригинал ведёт на копию
  assert.equal((await app.request(`/api/me/claims/${c1.id}/transfer`, { method: 'POST', headers: auth(bob.accessJwt) })).status, 404, 'чужую заявку не забрать')
  assert.equal((await app.request(`/api/me/claims/${solo.id}/transfer`, { method: 'POST', headers: auth(bob.accessJwt) })).status, 409, 'не одобрена')
  const tr = await (await app.request(`/api/me/claims/${c1.id}/transfer`, { method: 'POST', headers: auth(alice.accessJwt) })).json()
  assert.equal(tr.moved, 1, 'только статьи ilya_bashkirov с habr.com')
  assert.equal(tr.articles[0].oldUri, byIlya)
  assert.ok(tr.articles[0].newUri.startsWith(`at://${alice.user.did}/`))
  const copy = published.find((p) => p.repo === alice.user.did)!
  assert.equal(copy.record.claimedFrom, byIlya)
  assert.equal((await app.request(`/api/me/claims/${c1.id}/transfer`, { method: 'POST', headers: auth(alice.accessJwt) })).status, 409, 'повторно не переносится')
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

test('shared drafts: login required, Yjs updates sync, editor becomes reviewer, publish carries reviewers and closes link', async () => {
  const Y = await import('yjs')
  const app = makeApp({ ipCountry: { '5.1.1.1': 'DE' } })
  const a = await (await app.request('/api/auth/register', json({ ...reg, username: 'author', email: 'au@example.com' }, '5.1.1.1'))).json()
  const b = await (await app.request('/api/auth/register', json({ ...reg, username: 'reviewer', email: 're@example.com' }, '5.1.1.1'))).json()
  const c = await (await app.request('/api/auth/register', json({ ...reg, username: 'reader', email: 'rd@example.com' }, '5.1.1.1'))).json()
  const H = (t: string) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' })
  const draft = await (await app.request('/api/me/drafts', { method: 'POST', headers: H(a.accessJwt), body: JSON.stringify({ title: 'Общий', text: 'абзац' }) })).json()
  const share = await (await app.request(`/api/me/drafts/${draft.id}/share`, { method: 'POST', headers: H(a.accessJwt) })).json()
  assert.match(share.token, /^sd_/)
  assert.equal((await app.request(`/api/me/drafts/${draft.id}/share`, { method: 'POST', headers: H(b.accessJwt) })).status, 404, 'чужой черновик не расшарить')
  assert.equal((await app.request(`/api/shared/${share.token}`)).status, 401, 'без входа не открыть')

  const doc = new Y.Doc()
  doc.getText('t').insert(0, 'абзац')
  const b64 = (u: Uint8Array) => Buffer.from(u).toString('base64')
  const push = (t: string, data: Uint8Array, extra: object = {}) => app.request(`/api/shared/${share.token}/updates`, { method: 'POST', headers: H(t), body: JSON.stringify({ data: b64(data), ...extra }) })
  assert.equal((await push(b.accessJwt, Y.encodeStateAsUpdate(doc), { seed: true })).status, 403, 'наполняет только автор')
  assert.equal((await push(a.accessJwt, Y.encodeStateAsUpdate(doc), { seed: true })).status, 201)
  assert.equal((await push(a.accessJwt, Y.encodeStateAsUpdate(doc), { seed: true })).status, 409, 'повторно не наполнить')

  // рецензент забирает документ, правит
  const remote = new Y.Doc()
  for (const u of (await (await app.request(`/api/shared/${share.token}/updates?after=0`, { headers: H(b.accessJwt) })).json()).updates) Y.applyUpdate(remote, Buffer.from(u.data, 'base64'))
  assert.equal(remote.getText('t').toString(), 'абзац')
  const sv = Y.encodeStateVector(remote)
  remote.getText('t').insert(5, ' и правка')
  assert.equal((await push(b.accessJwt, Y.encodeStateAsUpdate(remote, sv), { edited: true })).status, 201)
  // просто открыл, ничего не менял — не рецензент
  assert.equal((await push(c.accessJwt, new Uint8Array([0, 0]))).status, 201)
  await app.request(`/api/shared/${share.token}/text`, { method: 'PUT', headers: H(b.accessJwt), body: JSON.stringify({ title: 'Общий', text: 'абзац и правка' }) })

  const view = await (await app.request(`/api/shared/${share.token}`, { headers: H(c.accessJwt) })).json()
  assert.equal(view.text, 'абзац и правка')
  assert.equal(view.isOwner, false)
  assert.deepEqual(view.reviewers.map((r: { handle: string }) => r.handle), ['reviewer.indie.media'])

  const pub = await app.request('/api/me/articles', { method: 'POST', headers: H(a.accessJwt), body: JSON.stringify({ title: 'Общий', text: 'абзац и правка', draftId: draft.id }) })
  assert.equal(pub.status, 201)
  const rec = published.at(-1)!.record as { reviewers?: { did: string; handle?: string }[] }
  assert.deepEqual(rec.reviewers, [{ did: b.user.did, handle: 'reviewer.indie.media' }])
  assert.equal((await app.request(`/api/shared/${share.token}`, { headers: H(b.accessJwt) })).status, 410, 'после публикации ссылка закрыта')
})

test('standard.site: copy on publish by default, opt-out checkbox, author button only for records already in PDS', async () => {
  const app = makeApp()
  const u = await (await app.request('/api/auth/register', json({ ...reg, username: 'stdwriter', email: 'std@example.com' }, '1.1.1.1'))).json()
  const H = { authorization: `Bearer ${u.accessJwt}`, 'content-type': 'application/json' }
  const pub = async (b: unknown) => (await (await app.request('/api/me/articles', { method: 'POST', headers: H, body: JSON.stringify(b) })).json()) as { uri: string }
  const doc = (rkey: string) => stored.get(`${u.user.did}/site.standard.document/${rkey}`) as Record<string, unknown> | undefined

  const a = await pub({ title: 'С копией', text: 'абзац' })
  const ra = a.uri.split('/').pop()!
  assert.equal(doc(ra)?.title, 'С копией', 'галочка по умолчанию — копия есть')
  assert.equal(doc(ra)?.weatArticle, a.uri)

  const b = await pub({ title: 'Без копии', text: 'абзац', standardSite: false })
  const rb = b.uri.split('/').pop()!
  assert.equal(doc(rb), undefined, 'галочку сняли — копии нет')

  // кнопка у автора: состояние и копия задним числом
  const status = (rkey: string, h = H) => app.request(`/api/me/articles/${rkey}/standard-site`, { headers: h })
  assert.deepEqual(await (await status(rb)).json(), { inPds: true, eligible: true, mirrored: false })
  const made = await app.request(`/api/me/articles/${rb}/standard-site`, { method: 'POST', headers: H })
  assert.equal(made.status, 201)
  assert.equal(doc(rb)?.title, 'Без копии')
  assert.equal((await (await status(rb)).json()).mirrored, true)

  // не записано в PDS (охлаждение, чужая или несуществующая статья) — кнопки нет
  assert.equal((await (await status('nope')).json()).inPds, false)
  const missing = await app.request('/api/me/articles/nope/standard-site', { method: 'POST', headers: H })
  assert.equal(missing.status, 409)
  assert.equal((await missing.json()).error, 'NotInRepository')

  const n = await pub({ title: 'Скрытая', text: 'абзац', noindex: true })
  const rn = n.uri.split('/').pop()!
  assert.equal(doc(rn), undefined, 'noindex не копируется даже с галочкой')
  assert.equal((await (await status(rn)).json()).eligible, false)
  assert.equal((await app.request(`/api/me/articles/${rn}/standard-site`, { method: 'POST', headers: H })).status, 400)
  assert.equal((await app.request(`/api/me/articles/${ra}/standard-site`, { method: 'POST' })).status, 401)
})

test('standard.site with cooldown: opt-out mark never reaches the repo, copy made only when allowed', async () => {
  const app = makeApp({ cooldown: true, ipCountry: { '5.1.1.1': 'DE' } })
  const u = await (await app.request('/api/auth/register', json({ ...reg, username: 'stdcool', email: 'stdcool@example.com' }, '5.1.1.1'))).json()
  const H = { authorization: `Bearer ${u.accessJwt}`, 'content-type': 'application/json' }
  const pub = async (b: unknown) => (await (await app.request('/api/me/articles', { method: 'POST', headers: H, body: JSON.stringify(b) })).json()) as { uri: string }
  const yes = await pub({ title: 'Да', text: 'текст' })
  const no = await pub({ title: 'Нет', text: 'текст', standardSite: false })
  for (const r of [yes, no]) (await cooldownLast!.repo.get(r.uri))!.publish_at = new Date(Date.now() - 1000)
  assert.equal(await cooldownLast!.publishDue(), 2)
  const rec = (uri: string) => stored.get(`${u.user.did}/media.weat.article/${uri.split('/').pop()}`)!
  const doc = (uri: string) => stored.get(`${u.user.did}/site.standard.document/${uri.split('/').pop()}`)
  assert.equal(rec(no.uri).title, 'Нет')
  assert.equal('$weatNoStandardSite' in rec(no.uri), false, 'служебная метка не в репозитории')
  assert.equal(doc(no.uri), undefined)
  assert.equal((doc(yes.uri) as { title?: string } | undefined)?.title, 'Да')
})

test('cooldown: article and comment stay on the site 24h, editable and deletable; then published to the repo at the same uri; staff sees the queue', async () => {
  const app = makeApp({ cooldown: true, ipCountry: { '5.1.1.1': 'DE' } })
  const a = await (await app.request('/api/auth/register', json({ ...reg, username: 'coolwriter', email: 'cool@example.com' }, '5.1.1.1'))).json()
  const H = { authorization: `Bearer ${a.accessJwt}`, 'content-type': 'application/json' }
  const before = published.length
  const res = await (await app.request('/api/me/articles', { method: 'POST', headers: H, body: JSON.stringify({ title: 'Остынет', text: 'текст' }) })).json()
  assert.match(res.uri, /^at:\/\/did:plc:coolwriter\/media\.weat\.article\/[a-z2-7]{13}$/)
  assert.ok(res.pendingUntil, 'есть срок')
  assert.equal(published.length, before, 'в репозиторий не ушло')

  // превью для соцсетей — тоже сразу: свой заголовок и своя картинка
  const short = `${res.uri.split('/').pop()}-${'did:plc:coolwriter'.slice(-6)}`
  const share = await (await app.request(`/api/share/article/${short}`)).text()
  assert.match(share, /og:title" content="Остынет"/)
  assert.match(share, new RegExp(`og:image" content="[^"]*/api/og/article/${short}\\.png"`))
  // на сайте видна сразу
  const page = await (await app.request(`/api/feed/article?uri=${encodeURIComponent(res.uri)}`)).json()
  assert.equal(page.record.title, 'Остынет')
  assert.ok(page.pendingUntil)

  // правка автором; чужой — нет
  const q = `?uri=${encodeURIComponent(res.uri)}`
  assert.equal((await app.request(`/api/me/pending${q}`, { method: 'PUT', headers: H, body: JSON.stringify({ title: 'Остынет 2', text: 'новый текст' }) })).status, 200)
  const b = await (await app.request('/api/auth/register', json({ ...reg, username: 'stranger', email: 'st@example.com' }, '5.1.1.1'))).json()
  assert.equal((await app.request(`/api/me/pending${q}`, { method: 'DELETE', headers: { authorization: `Bearer ${b.accessJwt}` } })).status, 404)

  // комментарий тоже ждёт; удалённый в охлаждении — без следа
  const com = await (await app.request('/api/me/comments', { method: 'POST', headers: H, body: JSON.stringify({ subject: res.uri, text: 'мнение' }) })).json()
  assert.ok(com.pendingUntil)
  assert.equal((await app.request(`/api/me/comments/${com.uri.split('/').pop()}`, { method: 'DELETE', headers: H })).status, 200)
  assert.equal(published.length, before)

  // модератор видит очередь; без роли — нет
  assert.equal((await app.request('/api/admin/cooldown')).status, 401)
  const queue = await (await app.request('/api/admin/cooldown', { headers: { authorization: `Bearer ${await staffToken(['moderator'])}` } })).json()
  assert.deepEqual(queue.items.map((i: { uri: string }) => i.uri), [res.uri])

  // срок вышел — публикуется в репозиторий автора по тому же адресу, с правкой
  await cooldownLast!.repo.update(res.uri, (await cooldownLast!.repo.get(res.uri))!.record)
  ;(await cooldownLast!.repo.get(res.uri))!.publish_at = new Date(Date.now() - 1000)
  assert.equal(await cooldownLast!.publishDue(), 1)
  const rkey = res.uri.split('/').pop()
  assert.equal((stored.get(`did:plc:coolwriter/media.weat.article/${rkey}`) as { title?: string } | undefined)?.title, 'Остынет 2')
  assert.equal((await app.request(`/api/me/pending${q}`, { method: 'DELETE', headers: H })).status, 409, 'после публикации — уже не ждущая')
})

test('yandex: account from the other contour — sign in there, no duplicate account', async () => {
  const SECRET = 'peer-secret-0123456789-0123456789-abcd'
  // NL: аккаунт создан раньше, когда входили из-за границы
  const nl = makeApp({ contour: 'global', peerSecret: SECRET, ipCountry: { '5.1.1.1': 'NL', '95.1.1.1': 'RU' } })
  const first = await yandexFlow(nl, 'code-ivan', '5.1.1.1')
  const nlUser = await (await nl.request('/api/auth/handoff', json({ code: first.searchParams.get('handoff')! }, '5.1.1.1'))).json()

  // без общего секрета сосед ничего не отдаёт
  const ask = (secret?: string) =>
    nl.request('/api/peer/oauth-login', { method: 'POST', headers: { 'x-indie-peer-hop': '1', 'content-type': 'application/json', ...(secret ? { authorization: `Bearer ${secret}` } : {}) }, body: JSON.stringify({ provider: 'yandex', providerUserId: '1001', country: 'RU' }) })
  assert.equal((await ask()).status, 404)
  assert.equal((await ask('wrong-secret-wrong-secret-wrong-secret')).status, 404)

  // RU: привязки нет — спрашивает NL и уводит на его адрес с кодом входа
  const ru = makeApp({
    contour: 'ru',
    ipCountry: { '95.1.1.1': 'RU' },
    peer: {
      publicUrl: 'https://nl-1.weat.test',
      resolve: async () => null,
      profile: async () => null,
      oauthLogin: async (provider, providerUserId, country) => {
        const r = await nl.request('/api/peer/oauth-login', { method: 'POST', headers: { 'x-indie-peer-hop': '1', 'content-type': 'application/json', authorization: `Bearer ${SECRET}` }, body: JSON.stringify({ provider, providerUserId, country }) })
        return r.ok ? ((await r.json()) as { code: string }).code : null
      },
    },
  })
  const viaRu = await yandexFlow(ru, 'code-ivan', '95.1.1.1')
  assert.equal(viaRu.origin, 'https://nl-1.weat.test', 'вход — в контуре, где аккаунт')
  const again = await (await nl.request('/api/auth/handoff', json({ code: viaRu.searchParams.get('handoff')! }, '95.1.1.1'))).json()
  assert.equal(again.user.did, nlUser.user.did, 'тот же аккаунт')
  assert.equal(await (await ru.request('/api/users/ivan-petrov-2.indie.media')).status === 200, false, 'дубля в RU нет')
})

test('republished article: source {url, site, publishedAt} without crawledAt', async () => {
  const app = makeApp({ ipCountry: { '5.1.1.1': 'DE' } })
  const a = await (await app.request('/api/auth/register', json({ ...reg, username: 'reprint', email: 'rp@example.com' }, '5.1.1.1'))).json()
  const H = { authorization: `Bearer ${a.accessJwt}`, 'content-type': 'application/json' }
  const res = await app.request('/api/me/articles', { method: 'POST', headers: H, body: JSON.stringify({ title: 'Zod умер', text: 'текст', republished: { url: 'https://www.habr.com/ru/articles/789384/', publishedAt: '2024-01-26' } }) })
  assert.equal(res.status, 201)
  assert.deepEqual(published.at(-1)!.record.source, { url: 'https://www.habr.com/ru/articles/789384/', site: 'habr.com', publishedAt: '2024-01-26T00:00:00.000Z' })
  const bad = await app.request('/api/me/articles', { method: 'POST', headers: H, body: JSON.stringify({ title: 'x', text: 'y', republished: { url: 'javascript:alert(1)' } }) })
  assert.equal(bad.status, 400)
  const future = await app.request('/api/me/articles', { method: 'POST', headers: H, body: JSON.stringify({ title: 'x', text: 'y', republished: { url: 'https://habr.com/a', publishedAt: new Date(Date.now() + 86_400_000).toISOString() } }) })
  assert.equal(future.status, 400, 'перепечатка из будущего')
})

test('pending article edit keeps and updates republishing metadata', async () => {
  const app = makeApp({ cooldown: true, ipCountry: { '5.1.1.1': 'DE' } })
  const a = await (await app.request('/api/auth/register', json({ ...reg, username: 'reprint-edit', email: 're@example.com' }, '5.1.1.1'))).json()
  const H = { authorization: `Bearer ${a.accessJwt}`, 'content-type': 'application/json' }
  const created = await (await app.request('/api/me/articles', { method: 'POST', headers: H, body: JSON.stringify({ title: 'Перепечатка', text: 'текст', republished: { url: 'https://habr.com/ru/articles/1/', publishedAt: '2024-01-26' } }) })).json()
  const path = `/api/me/pending?uri=${encodeURIComponent(created.uri)}`
  const updated = await app.request(path, { method: 'PUT', headers: H, body: JSON.stringify({ title: 'Перепечатка', text: 'новый текст', noindex: true, republished: { url: 'https://habr.com/ru/articles/2/', publishedAt: '2024-02-27T12:30:00.000Z' } }) })
  assert.equal(updated.status, 200)
  const edited = await updated.json()
  assert.equal(edited.record.noindex, true)
  assert.deepEqual(edited.record.source, { url: 'https://habr.com/ru/articles/2/', site: 'habr.com', publishedAt: '2024-02-27T12:30:00.000Z' })
  assert.equal(edited.record.republished, undefined)
  const removed = await app.request(path, { method: 'PUT', headers: H, body: JSON.stringify({ title: 'Перепечатка', text: 'новый текст', noindex: false, republished: null }) })
  assert.equal(removed.status, 200)
  const original = await removed.json()
  assert.equal(original.record.noindex, undefined)
  assert.equal(original.record.source, undefined)
})

test('yandex: existing duplicate in this contour — the older account (peer) wins', async () => {
  const SECRET = 'peer-secret-0123456789-0123456789-abcd'
  const nl = makeApp({ contour: 'global', peerSecret: SECRET, ipCountry: { '5.1.1.1': 'NL', '95.1.1.1': 'RU' } })
  const first = await yandexFlow(nl, 'code-ivan', '5.1.1.1')
  const nlUser = await (await nl.request('/api/auth/handoff', json({ code: first.searchParams.get('handoff')! }, '5.1.1.1'))).json()
  let peerOn = false
  const ru = makeApp({
    contour: 'ru',
    ipCountry: { '95.1.1.1': 'RU' },
    peer: {
      publicUrl: 'https://nl-1.weat.test',
      resolve: async () => null,
      profile: async () => null,
      oauthLogin: async (provider, providerUserId, country, olderThan) => {
        if (!peerOn) return null
        const r = await nl.request('/api/peer/oauth-login', { method: 'POST', headers: { 'x-indie-peer-hop': '1', 'content-type': 'application/json', authorization: `Bearer ${SECRET}` }, body: JSON.stringify({ provider, providerUserId, country, olderThan }) })
        return r.ok ? ((await r.json()) as { code: string }).code : null
      },
    },
  })
  // дубль создан, пока проверки соседа не было
  await new Promise((r) => setTimeout(r, 5))
  const dup = await yandexFlow(ru, 'code-ivan', '95.1.1.1')
  assert.ok(dup.searchParams.get('handoff'), 'в RU появился свой (более новый) аккаунт')
  peerOn = true
  const again = await yandexFlow(ru, 'code-ivan', '95.1.1.1')
  assert.equal(again.origin, 'https://nl-1.weat.test', 'основной — старший, в NL')
  const s = await (await nl.request('/api/auth/handoff', json({ code: again.searchParams.get('handoff')! }, '95.1.1.1'))).json()
  assert.equal(s.user.did, nlUser.user.did)
})

test('cooldown: rescheduling sets the site date and keeps a full 24h before AT', async () => {
  const app = makeApp({ cooldown: true, ipCountry: { '5.1.1.1': 'DE' } })
  const a = await (await app.request('/api/auth/register', json({ ...reg, username: 'resched', email: 'rs@example.com' }, '5.1.1.1'))).json()
  const H = { authorization: `Bearer ${a.accessJwt}`, 'content-type': 'application/json' }
  const res = await (await app.request('/api/me/articles', { method: 'POST', headers: H, body: JSON.stringify({ title: 'Сначала сразу', text: 'текст' }) })).json()
  const page = () => app.request(`/api/feed/article?uri=${encodeURIComponent(res.uri)}`)
  assert.equal((await page()).status, 200, 'обычная — видна сразу')
  const at = new Date(Date.now() + 72 * 3600_000).toISOString()
  const put = await app.request(`/api/me/pending?uri=${encodeURIComponent(res.uri)}`, { method: 'PUT', headers: H, body: JSON.stringify({ title: 'Теперь отложена', text: 'текст', publishAt: at }) })
  assert.equal(put.status, 200)
  assert.notEqual((await page()).status, 200, 'отложена на 3 дня — гостю не видна')
  const mine = await (await app.request('/api/me/pending', { headers: H })).json()
  const item = mine.items.find((i: { uri: string }) => i.uri === res.uri)
  assert.equal(item.scheduledAt, at, 'на сайте — в назначенное время')
  assert.equal(item.pendingUntil, new Date(new Date(at).getTime() + cooldownLast!.ms).toISOString(), 'в AT — после полного охлаждения на сайте')
  assert.equal(item.record.createdAt, at)
})

test('cooldown: an unpublished scheduled article returns to drafts without reaching AT', async () => {
  const app = makeApp({ cooldown: true, ipCountry: { '5.1.1.1': 'DE' } })
  const a = await (await app.request('/api/auth/register', json({ ...reg, username: 'backtodraft', email: 'bd@example.com' }, '5.1.1.1'))).json()
  const H = { authorization: `Bearer ${a.accessJwt}`, 'content-type': 'application/json' }
  const at = new Date(Date.now() + 72 * 3600_000).toISOString()
  const res = await (await app.request('/api/me/articles', { method: 'POST', headers: H, body: JSON.stringify({ title: 'Пока отложена', subtitle: 'Подзаголовок', text: 'Текст статьи', tags: ['тест'], publishAt: at }) })).json()
  const q = `?uri=${encodeURIComponent(res.uri)}`
  const before = published.length
  const moved = await app.request(`/api/me/pending/to-draft${q}`, { method: 'POST', headers: H })
  assert.equal(moved.status, 201)
  const { draft } = await moved.json()
  assert.equal(draft.title, 'Пока отложена')
  assert.equal(draft.text, '# Пока отложена\n\nТекст статьи')
  assert.equal(draft.meta.subtitle, 'Подзаголовок')
  assert.equal(draft.meta.scheduleMode, 'now')
  assert.equal((await app.request(`/api/feed/article${q}`)).status, 404, 'снята с отложенной публикации')
  assert.equal((await app.request(`/api/me/pending${q}`, { method: 'DELETE', headers: H })).status, 404)
  const drafts = await (await app.request('/api/me/drafts', { headers: H })).json()
  assert.equal(drafts.drafts[0].id, draft.id)
  assert.equal(published.length, before, 'в репозиторий ничего не ушло')

  const visible = await (await app.request('/api/me/articles', { method: 'POST', headers: H, body: JSON.stringify({ title: 'Уже видна', text: 'текст' }) })).json()
  const refuse = await app.request(`/api/me/pending/to-draft?uri=${encodeURIComponent(visible.uri)}`, { method: 'POST', headers: H })
  assert.equal(refuse.status, 409, 'опубликованную на сайте запись нельзя скрыть в черновики')
})
