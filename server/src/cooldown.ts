import { randomBytes, randomInt } from 'node:crypto'
import { mirrorStandardDoc, STANDARD_OPT_OUT_FIELD } from './standardDoc.js'
import { ARTICLE_COLLECTION } from './paidContent.js'
import type { Context, Hono } from 'hono'
import { z } from 'zod'
import type { Sql } from './db.js'
import { MAX_DRAFTS, type DraftRepo } from './drafts.js'
import { PdsError, type PdsClient } from './pds.js'
import type { SecretBox } from './secretbox.js'

/**
 * Период охлаждения: статьи и комментарии, опубликованные с сайта, 24 ч не уходят в AT Protocol.
 * Всё это время запись видна на weat.media (лента, страница статьи, тред), а автор может её править или удалить —
 * в сети (Bluesky, релеи, другие AppView) от неё не останется следа. Досрочно выйти нельзя.
 *
 * rkey выдаётся сразу, поэтому адрес at://did/collection/rkey не меняется после публикации. Когда срок вышел,
 * сервер входит в PDS автора app-паролем «weat-cooldown» (создаётся при первой публикации, хранится
 * зашифрованным) и кладёт запись putRecord'ом. Публикует только primary-узел.
 */

export const COOLDOWN_MS = 24 * 3600_000
const APP_PASSWORD_NAME = 'weat-cooldown'

export interface PendingRow {
  uri: string
  did: string
  handle: string
  collection: string
  rkey: string
  record: Record<string, unknown>
  visible_at: Date
  publish_at: Date
  status: 'pending' | 'published' | 'failed'
  attempts: number
  error: string | null
  created_at: Date
  updated_at: Date
}

export interface CooldownRepo {
  insert(r: Omit<PendingRow, 'status' | 'attempts' | 'error' | 'created_at' | 'updated_at'>): Promise<PendingRow>
  get(uri: string): Promise<PendingRow | undefined>
  /** ждущие (и только что опубликованные — пока их не проиндексировала лента) */
  /** visibleOnly — только вышедшие на сайте (отложенные до своего времени видит лишь автор) */
  list(q: { collection: string; did?: string; subject?: string; limit?: number; visibleOnly?: boolean }): Promise<PendingRow[]>
  update(uri: string, record: Record<string, unknown>): Promise<PendingRow | undefined>
  /** перенос сроков ждущей записи (правка «отложенной» даты) */
  reschedule(uri: string, visibleAt: Date, publishAt: Date): Promise<PendingRow | undefined>
  remove(uri: string): Promise<boolean>
  due(limit: number): Promise<PendingRow[]>
  /** false — строку удалили, пока шла публикация */
  markPublished(uri: string): Promise<boolean>
  markFailed(uri: string, error: string, retryAt: Date | null): Promise<void>
  getCreds(did: string): Promise<{ enc: string; name: string } | undefined>
  setCreds(did: string, enc: string, name: string): Promise<void>
  dropCreds(did: string): Promise<void>
}

export function cooldownRepo(sql: Sql): CooldownRepo {
  return {
    async insert(r) {
      const [row] = await sql<PendingRow[]>`
        INSERT INTO pending_records (uri, did, handle, collection, rkey, record, visible_at, publish_at)
        VALUES (${r.uri}, ${r.did}, ${r.handle}, ${r.collection}, ${r.rkey}, ${sql.json(r.record as never)}, ${r.visible_at}, ${r.publish_at})
        RETURNING *`
      return row!
    },
    async get(uri) {
      const [row] = await sql<PendingRow[]>`SELECT * FROM pending_records WHERE uri = ${uri}`
      return row
    },
    list: ({ collection, did, subject, limit = 100, visibleOnly = true }) => sql<PendingRow[]>`
      SELECT * FROM pending_records
      WHERE collection = ${collection}
        AND (status = 'pending' OR (status = 'published' AND updated_at > now() - interval '10 minutes'))
        ${visibleOnly ? sql`AND visible_at <= now()` : sql``}
        ${did ? sql`AND did = ${did}` : sql``}
        ${subject ? sql`AND record->'subject'->>'uri' = ${subject}` : sql``}
      ORDER BY created_at DESC LIMIT ${limit}`,
    async update(uri, record) {
      const [row] = await sql<PendingRow[]>`
        UPDATE pending_records SET record = ${sql.json(record as never)}, updated_at = now()
        WHERE uri = ${uri} AND status = 'pending' RETURNING *`
      return row
    },
    async remove(uri) {
      return (await sql`DELETE FROM pending_records WHERE uri = ${uri} AND status <> 'published' RETURNING 1`).length > 0
    },
    async reschedule(uri, visibleAt, publishAt) {
      const [row] = await sql<PendingRow[]>`
        UPDATE pending_records SET visible_at = ${visibleAt}, publish_at = ${publishAt}, updated_at = now()
        WHERE uri = ${uri} AND status <> 'published' RETURNING *`
      return row
    },
    due: (limit) => sql<PendingRow[]>`
      SELECT * FROM pending_records WHERE status IN ('pending', 'failed') AND publish_at <= now() AND attempts < 20
      ORDER BY publish_at LIMIT ${limit}`,
    async markPublished(uri) {
      const done = (await sql`UPDATE pending_records SET status = 'published', error = NULL, updated_at = now() WHERE uri = ${uri} RETURNING 1`).length > 0
      // старые опубликованные строки больше не нужны: запись уже в репозитории и в индексе
      await sql`DELETE FROM pending_records WHERE status = 'published' AND updated_at < now() - interval '1 day'`
      return done
    },
    async markFailed(uri, error, retryAt) {
      await sql`
        UPDATE pending_records SET status = 'failed', attempts = attempts + 1, error = ${error.slice(0, 500)},
          publish_at = COALESCE(${retryAt}, publish_at), updated_at = now()
        WHERE uri = ${uri}`
    },
    async getCreds(did) {
      const [r] = await sql<{ app_password_enc: string; app_password_name: string }[]>`SELECT * FROM cooldown_creds WHERE did = ${did}`
      return r ? { enc: r.app_password_enc, name: r.app_password_name } : undefined
    },
    async setCreds(did, enc, name) {
      await sql`
        INSERT INTO cooldown_creds (did, app_password_enc, app_password_name) VALUES (${did}, ${enc}, ${name})
        ON CONFLICT (did) DO UPDATE SET app_password_enc = EXCLUDED.app_password_enc, app_password_name = EXCLUDED.app_password_name`
    },
    async dropCreds(did) {
      await sql`DELETE FROM cooldown_creds WHERE did = ${did}`
    },
  }
}

/** для тестов */
export function memCooldown(): CooldownRepo {
  const rows = new Map<string, PendingRow>()
  const creds = new Map<string, { enc: string; name: string }>()
  return {
    async insert(r) {
      const row: PendingRow = { ...r, status: 'pending', attempts: 0, error: null, created_at: new Date(), updated_at: new Date() }
      rows.set(r.uri, row)
      return row
    },
    get: async (uri) => rows.get(uri),
    list: async ({ collection, did, subject, limit = 100, visibleOnly = true }) =>
      [...rows.values()]
        .filter((r) => !visibleOnly || r.visible_at <= new Date())
        .filter((r) => r.collection === collection && (r.status === 'pending' || (r.status === 'published' && Date.now() - r.updated_at.getTime() < 600_000)))
        .filter((r) => (!did || r.did === did) && (!subject || (r.record.subject as { uri?: string } | undefined)?.uri === subject))
        .sort((a, b) => b.created_at.getTime() - a.created_at.getTime())
        .slice(0, limit),
    async update(uri, record) {
      const r = rows.get(uri)
      if (!r || r.status !== 'pending') return undefined
      Object.assign(r, { record, updated_at: new Date() })
      return r
    },
    remove: async (uri) => rows.get(uri)?.status !== 'published' && rows.delete(uri),
    async reschedule(uri, visible_at, publish_at) {
      const r = rows.get(uri)
      if (!r || r.status === 'published') return undefined
      Object.assign(r, { visible_at, publish_at, updated_at: new Date() })
      return r
    },
    due: async (limit) => [...rows.values()].filter((r) => r.status !== 'published' && r.publish_at <= new Date() && r.attempts < 20).slice(0, limit),
    async markPublished(uri) {
      const r = rows.get(uri)
      if (r) Object.assign(r, { status: 'published', error: null, updated_at: new Date() })
      return !!r
    },
    async markFailed(uri, error, retryAt) {
      const r = rows.get(uri)
      if (r) Object.assign(r, { status: 'failed', attempts: r.attempts + 1, error, publish_at: retryAt ?? r.publish_at, updated_at: new Date() })
    },
    getCreds: async (did) => creds.get(did),
    async setCreds(did, enc, name) {
      creds.set(did, { enc, name })
    },
    async dropCreds(did) {
      creds.delete(did)
    },
  }
}

/** TID (AT Protocol): 53 бита микросекунд + 10 бит clock id, base32-sortable — как у PDS */
const S32 = '234567abcdefghijklmnopqrstuvwxyz'
let lastTid = 0
export function nextTid(): string {
  let us = Date.now() * 1000
  if (us <= lastTid) us = lastTid + 1
  lastTid = us
  let n = (BigInt(us) << 10n) | BigInt(randomInt(1024))
  let s = ''
  for (let i = 0; i < 13; i++) {
    s = S32[Number(n & 31n)]! + s
    n >>= 5n
  }
  return s
}

/**
 * Отложенная запись выходит на сайте в назначенное время и уходит в AT через ms после этого;
 * обычная видна на сайте сразу и уходит в AT через ms.
 */
export function cooldownWindow(scheduledAt: Date | undefined | null, ms: number, now = Date.now()): { visible: Date; publish: Date } {
  const visible = scheduledAt && scheduledAt.getTime() > now + 60_000 ? scheduledAt.getTime() : now
  return { visible: new Date(visible), publish: new Date(visible + ms) }
}

export interface Cooldown {
  repo: CooldownRepo
  ms: number
  /** отложить запись; null — отложить нельзя (вход без пароля PDS) — тогда публикуем сразу */
  /** scheduledAt — время выхода на сайте; в AT запись уйдёт через ms после него. */
  hold(s: { token: string; did: string; handle: string }, collection: string, record: Record<string, unknown>, scheduledAt?: Date): Promise<PendingRow | null>
  /** один проход публикации созревших записей */
  publishDue(): Promise<number>
}

export function createCooldown(d: { pds: PdsClient; secrets: SecretBox; repo: CooldownRepo; ms?: number; siteUrl?: string }): Cooldown {
  const ms = d.ms ?? COOLDOWN_MS
  return {
    repo: d.repo,
    ms,
    async hold(s, collection, record, scheduledAt) {
      if (!(await d.repo.getCreds(s.did))) {
        // app-пароль со старым именем (прошлая попытка) — убираем, иначе PDS откажет «уже существует»
        await d.pds.revokeAppPassword(s.token, APP_PASSWORD_NAME).catch(() => {})
        const pw = await d.pds.createAppPassword(s.token, APP_PASSWORD_NAME).catch(() => null)
        if (!pw) return null
        await d.repo.setCreds(s.did, d.secrets.seal(pw.password), APP_PASSWORD_NAME)
      }
      const rkey = nextTid()
      const w = cooldownWindow(scheduledAt, ms)
      return d.repo.insert({ uri: `at://${s.did}/${collection}/${rkey}`, did: s.did, handle: s.handle, collection, rkey, record, visible_at: w.visible, publish_at: w.publish })
    },
    async publishDue() {
      let n = 0
      for (const r of await d.repo.due(50)) {
        try {
          const creds = await d.repo.getCreds(r.did)
          if (!creds) throw new Error('нет app-пароля для публикации')
          const session = await d.pds.createSession(r.did, d.secrets.open(creds.enc))
          // метка «без standard.site» — только для нас: в репозиторий автора не пишем
          const { [STANDARD_OPT_OUT_FIELD]: noStandard, ...record } = r.record
          await d.pds.putRecord(session.accessJwt, r.did, r.collection, r.rkey, record)
          // автор удалил запись, пока она публиковалась, — убираем из репозитория
          if (!(await d.repo.markPublished(r.uri))) await d.pds.deleteRecord(session.accessJwt, r.did, r.collection, r.rkey).catch(() => {})
          else {
            n++
            if (r.collection === ARTICLE_COLLECTION && d.siteUrl && !noStandard) await mirrorStandardDoc(d.pds, session.accessJwt, r.did, r.rkey, record, d.siteUrl)
          }
        } catch (e) {
          // пароль приложения отозван — забываем его: следующая публикация с сайта создаст новый
          if (e instanceof PdsError && e.status === 401) await d.repo.dropCreds(r.did)
          // повтор с нарастающей паузой: 5 мин, 10, 20… (до 20 попыток)
          const wait = Math.min(24 * 3600_000, 5 * 60_000 * 2 ** Math.min(r.attempts, 8))
          await d.repo.markFailed(r.uri, e instanceof Error ? e.message : String(e), new Date(Date.now() + wait))
        }
      }
      return n
    },
  }
}

const scheduledVisibleAt = (r: PendingRow) => {
  if (r.collection !== 'media.weat.article' || !r.record.createdAt) return undefined
  const created = new Date(String(r.record.createdAt)).getTime()
  if (Math.abs(created - r.publish_at.getTime()) < 2000) return r.publish_at
  if (r.visible_at.getTime() > r.created_at.getTime() + 60_000 && Math.abs(created - r.visible_at.getTime()) < 2000) return r.visible_at
  return undefined
}

/** ждущая запись в форме ответа индекса ленты — сайт показывает её как обычную */
export const pendingFeedItem = (r: PendingRow) => {
  const scheduledAt = scheduledVisibleAt(r)
  return {
    uri: r.uri,
    cid: '',
    did: r.did,
    handle: r.handle,
    createdAt: String(r.record.createdAt ?? r.created_at.toISOString()),
    indexedAt: r.created_at.toISOString(),
    likeCount: 0,
    commentCount: 0,
    record: r.record,
    ...(r.status !== 'published' ? { pendingUntil: r.publish_at.toISOString() } : {}),
    ...(scheduledAt ? { scheduledAt: scheduledAt.toISOString() } : {}),
  }
}

const ArticleEdit = z.object({
  title: z.string().trim().min(1).max(300),
  subtitle: z.string().trim().max(300).optional(),
  text: z.string().max(200_000),
  excerpt: z.string().trim().max(500).optional(),
  tags: z.array(z.string().trim().min(1).max(64)).max(20).optional(),
  /** перенести выход на сайте (в AT — через 24 ч) или null — снять отложенную публикацию */
  publishAt: z.string().datetime({ offset: true }).nullable().optional(),
})
const CommentEdit = z.object({ text: z.string().trim().min(1).max(10_000) })

export function mountCooldownRoutes(
  app: Hono,
  d: { pds: PdsClient; cooldown: Cooldown; drafts: DraftRepo },
  h: { bearer(c: Context): string | undefined; requireStaff(c: Context, role: 'moderator'): Promise<unknown> },
) {
  // модерация: всё, что ждёт ухода в AT (и отложенное до выхода), — чтобы успеть поставить метку коллегии.
  // Только просмотр: править и удалять чужую запись нельзя; метка — через /admin/labels по тому же at:// адресу
  app.get('/admin/cooldown', async (c) => {
    await h.requireStaff(c, 'moderator')
    c.header('cache-control', 'private, no-store')
    const [articles, comments] = await Promise.all(
      ['media.weat.article', 'media.weat.comment'].map((collection) => d.cooldown.repo.list({ collection, visibleOnly: false, limit: 500 })),
    )
    return c.json({
      items: [...articles!, ...comments!]
        .filter((r) => r.status !== 'published')
        .map((r) => ({ ...pendingFeedItem(r), collection: r.collection, visibleAt: r.visible_at.toISOString(), status: r.status, error: r.error })),
    })
  })

  const own = async (c: Context) => {
    const token = h.bearer(c)
    if (!token) throw new PdsError(401, 'AuthenticationRequired', 'Нужно войти')
    c.header('cache-control', 'private, no-store')
    const { did } = await d.pds.getSession(token)
    const uri = c.req.query('uri') ?? ''
    const row = await d.cooldown.repo.get(uri)
    if (!row || row.did !== did) throw new PdsError(404, 'NotFound', 'Запись не найдена')
    if (row.status === 'published') throw new PdsError(409, 'AlreadyPublished', 'Срок охлаждения прошёл: запись уже в репозитории')
    return row
  }

  app.get('/me/pending', async (c) => {
    const token = h.bearer(c)
    if (!token) throw new PdsError(401, 'AuthenticationRequired', 'Нужно войти')
    c.header('cache-control', 'private, no-store')
    const { did } = await d.pds.getSession(token)
    const [articles, comments] = await Promise.all(
      ['media.weat.article', 'media.weat.comment'].map((collection) => d.cooldown.repo.list({ collection, did, visibleOnly: false })),
    )
    return c.json({ items: [...articles!, ...comments!].filter((r) => r.status !== 'published').map(pendingFeedItem) })
  })

  // правка ждущей записи: статья — заголовок, текст и др.; комментарий — текст
  app.put('/me/pending', async (c) => {
    const row = await own(c)
    const body = await c.req.json().catch(() => null)
    const parsed = row.collection === 'media.weat.comment' ? CommentEdit.safeParse(body) : ArticleEdit.safeParse(body)
    if (!parsed.success) throw new PdsError(400, 'InvalidRequest', z.prettifyError(parsed.error))
    const { publishAt, ...fields } = parsed.data as typeof parsed.data & { publishAt?: string | null }
    let record: Record<string, unknown> = { ...row.record, ...fields }
    if (publishAt !== undefined) {
      const w = publishAt ? cooldownWindow(new Date(publishAt), d.cooldown.ms) : cooldownWindow(null, d.cooldown.ms, Math.max(Date.now(), row.created_at.getTime()))
      if (!(await d.cooldown.repo.reschedule(row.uri, w.visible, w.publish))) throw new PdsError(409, 'AlreadyPublished', 'Запись уже публикуется')
      record = { ...record, createdAt: w.visible.toISOString() }
    }
    const updated = await d.cooldown.repo.update(row.uri, record)
    if (!updated) throw new PdsError(409, 'AlreadyPublished', 'Запись уже публикуется')
    return c.json(pendingFeedItem(updated))
  })

  app.post('/me/pending/to-draft', async (c) => {
    const row = await own(c)
    if (row.collection !== 'media.weat.article' || row.visible_at <= new Date()) {
      throw new PdsError(409, 'NotScheduled', 'В черновики можно вернуть только ещё не вышедшую отложенную статью')
    }
    if ((await d.drafts.count(row.did)) >= MAX_DRAFTS) throw new PdsError(409, 'TooManyDrafts', `Черновиков больше ${MAX_DRAFTS} — удалите ненужные`)
    const title = String(row.record.title ?? '')
    const text = String(row.record.text ?? '')
    const source = row.record.source as { url?: unknown; publishedAt?: unknown } | undefined
    const meta: Record<string, unknown> = {
      step: 1,
      scheduleMode: 'now',
      ...(row.record.subtitle ? { subtitle: row.record.subtitle } : {}),
      ...(Array.isArray(row.record.tags) ? { tags: row.record.tags } : {}),
      ...(Array.isArray(row.record.langs) && row.record.langs.length ? { language: row.record.langs[0] } : {}),
      ...(row.record.kind === 'video' ? { kind: 'video', videoMode: 'link', videoDesc: text } : {}),
      ...(Array.isArray(row.record.videos) ? { videos: row.record.videos } : {}),
      ...(row.record.noindex === true ? { noindex: true } : {}),
      ...(typeof source?.url === 'string' ? { republish: true, republishUrl: source.url, ...(typeof source.publishedAt === 'string' ? { republishDate: source.publishedAt } : {}) } : {}),
    }
    const draft = await d.drafts.save(row.did, `dr_${randomBytes(9).toString('base64url')}`, title, `# ${title}\n\n${text}`, meta)
    if (!(await d.cooldown.repo.remove(row.uri))) throw new PdsError(409, 'AlreadyPublished', 'Запись уже публикуется')
    return c.json({ draft: { id: draft.id, title: draft.title, text: draft.text, meta: draft.meta, createdAt: draft.created_at.toISOString(), updatedAt: draft.updated_at.toISOString() } }, 201)
  })

  // удалить без следа: в сеть запись не уходила
  app.delete('/me/pending', async (c) => {
    const row = await own(c)
    if (!(await d.cooldown.repo.remove(row.uri))) throw new PdsError(409, 'AlreadyPublished', 'Запись уже публикуется')
    return c.json({ ok: true })
  })
}

export type PendingItem = ReturnType<typeof pendingFeedItem> & { collection: string; subject?: string }

const toItem = (r: PendingRow): PendingItem => ({
  ...pendingFeedItem(r),
  collection: r.collection,
  ...((r.record.subject as { uri?: string } | undefined)?.uri ? { subject: (r.record.subject as { uri: string }).uri } : {}),
})

/**
 * Ждущие записи обоих контуров: своя база + соседний контур (PEER_CONTOUR_URL, /api/peer/cooldown).
 * Статья в охлаждении ещё не в AT, поэтому лента соседа сама её не увидит — берём у него напрямую.
 * Соседа опрашиваем не чаще раза в 20 с; недоступен — показываем только свои.
 */
export interface PendingSource {
  list(collection: string): Promise<PendingItem[]>
  get(uri: string): Promise<PendingItem | undefined>
}

export function pendingSource(d: { cooldown?: Cooldown; peerUrl?: string; fetchImpl?: typeof fetch }): PendingSource {
  let peerCache: { at: number; items: PendingItem[] } | null = null
  const peer = async (): Promise<PendingItem[]> => {
    if (!d.peerUrl) return []
    if (peerCache && Date.now() - peerCache.at < 20_000) return peerCache.items
    const res = await (d.fetchImpl ?? fetch)(`${d.peerUrl.replace(/\/$/, '')}/api/peer/cooldown`, {
      headers: { 'x-indie-peer-hop': '1' },
      signal: AbortSignal.timeout(2500),
    }).catch(() => null)
    const body = res?.ok ? ((await res.json().catch(() => null)) as { items?: PendingItem[] } | null) : null
    const items = (body?.items ?? []).filter((i) => typeof i?.uri === 'string' && i.uri.startsWith('at://did:') && typeof i.collection === 'string')
    peerCache = { at: Date.now(), items: res?.ok ? items : (peerCache?.items ?? []) }
    return peerCache.items
  }
  const local = async (collection: string) => (d.cooldown ? (await d.cooldown.repo.list({ collection })).map(toItem) : [])
  return {
    async list(collection) {
      const [mine, theirs] = await Promise.all([local(collection), peer()])
      const seen = new Set(mine.map((i) => i.uri))
      return [...mine, ...theirs.filter((i) => i.collection === collection && !seen.has(i.uri))]
    },
    async get(uri) {
      const row = d.cooldown ? await d.cooldown.repo.get(uri) : undefined
      if (row && row.status !== 'published' && row.visible_at <= new Date()) return toItem(row)
      return (await peer()).find((i) => i.uri === uri)
    },
  }
}

/** соседнему контуру — только свои ждущие и уже вышедшие на сайте записи (то же, что видят читатели) */
export function mountPeerCooldownRoute(app: Hono, d: { cooldown?: Cooldown }) {
  app.get('/peer/cooldown', async (c) => {
    if (c.req.header('x-indie-peer-hop') !== '1') return c.json({ error: 'NotFound', message: 'Не найдено' }, 404)
    if (!d.cooldown) return c.json({ items: [] })
    const [articles, comments] = await Promise.all(['media.weat.article', 'media.weat.comment'].map((collection) => d.cooldown!.repo.list({ collection, limit: 500 })))
    c.header('cache-control', 'public, max-age=10')
    return c.json({ items: [...articles!, ...comments!].filter((r) => r.status !== 'published').map(toItem) })
  })
}
