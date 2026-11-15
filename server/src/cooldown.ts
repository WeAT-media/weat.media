import { randomInt } from 'node:crypto'
import type { Context, Hono } from 'hono'
import { z } from 'zod'
import type { Sql } from './db.js'
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

export interface Cooldown {
  repo: CooldownRepo
  ms: number
  /** отложить запись; null — отложить нельзя (вход без пароля PDS) — тогда публикуем сразу */
  /** visibleAt — отложенный пост: выход на сайте; в AT — через ms после него */
  hold(s: { token: string; did: string; handle: string }, collection: string, record: Record<string, unknown>, visibleAt?: Date): Promise<PendingRow | null>
  /** один проход публикации созревших записей */
  publishDue(): Promise<number>
}

export function createCooldown(d: { pds: PdsClient; secrets: SecretBox; repo: CooldownRepo; ms?: number }): Cooldown {
  const ms = d.ms ?? COOLDOWN_MS
  return {
    repo: d.repo,
    ms,
    async hold(s, collection, record, visibleAt) {
      if (!(await d.repo.getCreds(s.did))) {
        // app-пароль со старым именем (прошлая попытка) — убираем, иначе PDS откажет «уже существует»
        await d.pds.revokeAppPassword(s.token, APP_PASSWORD_NAME).catch(() => {})
        const pw = await d.pds.createAppPassword(s.token, APP_PASSWORD_NAME).catch(() => null)
        if (!pw) return null
        await d.repo.setCreds(s.did, d.secrets.seal(pw.password), APP_PASSWORD_NAME)
      }
      const rkey = nextTid()
      const visible = visibleAt && visibleAt.getTime() > Date.now() ? visibleAt : new Date()
      return d.repo.insert({ uri: `at://${s.did}/${collection}/${rkey}`, did: s.did, handle: s.handle, collection, rkey, record, visible_at: visible, publish_at: new Date(visible.getTime() + ms) })
    },
    async publishDue() {
      let n = 0
      for (const r of await d.repo.due(50)) {
        try {
          const creds = await d.repo.getCreds(r.did)
          if (!creds) throw new Error('нет app-пароля для публикации')
          const session = await d.pds.createSession(r.did, d.secrets.open(creds.enc))
          await d.pds.putRecord(session.accessJwt, r.did, r.collection, r.rkey, r.record)
          // автор удалил запись, пока она публиковалась, — убираем из репозитория
          if (!(await d.repo.markPublished(r.uri))) await d.pds.deleteRecord(session.accessJwt, r.did, r.collection, r.rkey).catch(() => {})
          else n++
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

/** ждущая запись в форме ответа индекса ленты — сайт показывает её как обычную */
export const pendingFeedItem = (r: PendingRow) => ({
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
  ...(r.visible_at > new Date() ? { scheduledAt: r.visible_at.toISOString() } : {}),
})

const ArticleEdit = z.object({
  title: z.string().trim().min(1).max(300),
  subtitle: z.string().trim().max(300).optional(),
  text: z.string().max(200_000),
  excerpt: z.string().trim().max(500).optional(),
  tags: z.array(z.string().trim().min(1).max(64)).max(20).optional(),
})
const CommentEdit = z.object({ text: z.string().trim().min(1).max(10_000) })

export function mountCooldownRoutes(
  app: Hono,
  d: { pds: PdsClient; cooldown: Cooldown },
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
    const updated = await d.cooldown.repo.update(row.uri, { ...row.record, ...parsed.data })
    if (!updated) throw new PdsError(409, 'AlreadyPublished', 'Запись уже публикуется')
    return c.json(pendingFeedItem(updated))
  })

  // удалить без следа: в сеть запись не уходила
  app.delete('/me/pending', async (c) => {
    const row = await own(c)
    if (!(await d.cooldown.repo.remove(row.uri))) throw new PdsError(409, 'AlreadyPublished', 'Запись уже публикуется')
    return c.json({ ok: true })
  })
}
