import { randomBytes } from 'node:crypto'
import type { Context, Hono } from 'hono'
import { z } from 'zod'
import type { IdentityRepo, Sql } from './db.js'
import { PdsError, type PdsClient } from './pds.js'

/**
 * Импорт постов из привязанного AT-аккаунта (bsky.social, свой PDS) в черновики.
 * Посты читаются из публичного репозитория (app.bsky.feed.post) без токенов чужого PDS.
 * Черновик ничего не публикует: автор смотрит его, правит в редакторе или выпускает как есть —
 * публикация идёт обычным путём (/me/articles), черновик только помечается.
 */

export type ImportStatus = 'pending' | 'published' | 'dismissed'

export interface ImportDraftRow {
  id: string
  did: string
  source_uri: string
  source_created_at: Date
  title: string
  text: string
  status: ImportStatus
  article_uri: string | null
  created_at: Date
  updated_at: Date
}

export type NewImportDraft = Pick<ImportDraftRow, 'id' | 'did' | 'source_uri' | 'source_created_at' | 'title' | 'text'>

export interface ImportRepo {
  /** уже импортированные (по source_uri) пропускаются; возвращает число новых */
  insertMany(drafts: NewImportDraft[]): Promise<number>
  list(did: string, status: ImportStatus | null): Promise<ImportDraftRow[]>
  get(did: string, id: string): Promise<ImportDraftRow | undefined>
  setStatus(did: string, id: string, status: ImportStatus, articleUri: string | null): Promise<ImportDraftRow | undefined>
}

export function importRepo(sql: Sql): ImportRepo {
  return {
    async insertMany(drafts) {
      if (!drafts.length) return 0
      const rows = await sql`
        INSERT INTO import_drafts ${sql(drafts, 'id', 'did', 'source_uri', 'source_created_at', 'title', 'text')}
        ON CONFLICT (did, source_uri) DO NOTHING
        RETURNING id`
      return rows.length
    },
    async list(did, status) {
      return sql<ImportDraftRow[]>`
        SELECT * FROM import_drafts WHERE did = ${did} ${status ? sql`AND status = ${status}` : sql``}
        ORDER BY source_created_at DESC LIMIT 500`
    },
    async get(did, id) {
      const [r] = await sql<ImportDraftRow[]>`SELECT * FROM import_drafts WHERE did = ${did} AND id = ${id}`
      return r
    },
    async setStatus(did, id, status, articleUri) {
      const [r] = await sql<ImportDraftRow[]>`
        UPDATE import_drafts SET status = ${status}, article_uri = ${articleUri}, updated_at = now()
        WHERE did = ${did} AND id = ${id} RETURNING *`
      return r
    },
  }
}

// ── чтение чужого репозитория ───────────────────────────────────────────

export interface SourceRecord {
  uri: string
  cid: string
  value: Record<string, unknown>
}

/** публичные записи чужого репозитория; pds — адрес его сервера (для ссылок на картинки) */
export interface PostSource {
  posts(did: string, cursor?: string): Promise<{ pds: string; records: SourceRecord[]; cursor?: string }>
}

/** PDS из DID-документа: did:plc — через plc.directory, did:web — /.well-known/did.json */
async function resolvePds(did: string, plcUrl: string): Promise<string> {
  const docUrl = did.startsWith('did:plc:')
    ? `${plcUrl}/${did}`
    : did.startsWith('did:web:')
      ? `https://${decodeURIComponent(did.slice('did:web:'.length))}/.well-known/did.json`
      : null
  if (!docUrl) throw new PdsError(400, 'UnsupportedDid', 'Этот тип DID не поддерживается')
  const res = await fetch(docUrl, { signal: AbortSignal.timeout(5000) }).catch(() => null)
  if (!res?.ok) throw new PdsError(502, 'SourceUnavailable', 'Не удалось найти сервер AT-аккаунта')
  const doc = (await res.json()) as { service?: { id?: string; serviceEndpoint?: string }[] }
  const pds = doc.service?.find((s) => s.id === '#atproto_pds' || s.id?.endsWith('#atproto_pds'))?.serviceEndpoint
  if (!pds?.startsWith('https://')) throw new PdsError(502, 'SourceUnavailable', 'У AT-аккаунта не указан сервер')
  return pds.replace(/\/+$/, '')
}

export function atprotoPostSource(plcUrl = 'https://plc.directory'): PostSource {
  return {
    async posts(did, cursor) {
      const pds = await resolvePds(did, plcUrl)
      const q = new URLSearchParams({ repo: did, collection: POST_COLLECTION, limit: '100', ...(cursor ? { cursor } : {}) })
      const res = await fetch(`${pds}/xrpc/com.atproto.repo.listRecords?${q}`, { signal: AbortSignal.timeout(10_000) }).catch(() => null)
      if (!res?.ok) throw new PdsError(502, 'SourceUnavailable', 'Сервер AT-аккаунта не отдал посты. Попробуйте позже.')
      const body = (await res.json()) as { records: SourceRecord[]; cursor?: string }
      return { pds, records: body.records ?? [], cursor: body.cursor }
    },
  }
}

// ── пост → черновик ─────────────────────────────────────────────────────

export const POST_COLLECTION = 'app.bsky.feed.post'
/** больше постов за один импорт не читаем: 10 страниц по 100 */
const MAX_PAGES = 10
/** длиннее — заголовок обрезается, а абзац целиком остаётся в тексте */
const TITLE_MAX = 120

interface Facet {
  index?: { byteStart?: number; byteEnd?: number }
  features?: { $type?: string; uri?: string }[]
}

/** ссылки из facets → markdown; смещения в facets — байты UTF-8 */
function withLinks(text: string, facets: Facet[] | undefined): string {
  const links = (facets ?? [])
    .map((f) => ({ start: f.index?.byteStart, end: f.index?.byteEnd, uri: f.features?.find((x) => x.$type === 'app.bsky.richtext.facet#link')?.uri }))
    .filter((l): l is { start: number; end: number; uri: string } => typeof l.start === 'number' && typeof l.end === 'number' && !!l.uri && l.end > l.start)
    .sort((a, b) => b.start - a.start)
  let bytes = Buffer.from(text, 'utf8')
  for (const l of links) {
    if (l.end > bytes.length) continue
    const label = bytes.subarray(l.start, l.end).toString('utf8')
    bytes = Buffer.concat([bytes.subarray(0, l.start), Buffer.from(`[${label}](${l.uri})`, 'utf8'), bytes.subarray(l.end)])
  }
  return bytes.toString('utf8')
}

/** null — пост не импортируем (ответ в чужой ветке, пустой) */
export function postToDraft(did: string, pds: string, r: SourceRecord): Omit<NewImportDraft, 'id' | 'did'> | null {
  const v = r.value as {
    text?: string
    facets?: Facet[]
    reply?: unknown
    createdAt?: string
    embed?: {
      $type?: string
      images?: { alt?: string; image?: { ref?: { $link?: string } } }[]
      external?: { uri?: string; title?: string }
      media?: { images?: { alt?: string; image?: { ref?: { $link?: string } } }[] }
    }
  }
  if (v.reply) return null
  const text = withLinks(v.text ?? '', v.facets).trim()
  const blob = (cid: string) => `${pds}/xrpc/com.atproto.sync.getBlob?${new URLSearchParams({ did, cid })}`
  const parts = text ? text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean) : []
  // заголовок — первый абзац (без markdown ссылок); короткий уходит из текста целиком
  const first = (v.text ?? '').split(/\n{2,}/).map((p) => p.replace(/\s+/g, ' ').trim()).find(Boolean) ?? ''
  const title = first.length > TITLE_MAX ? `${first.slice(0, TITLE_MAX - 1).trimEnd()}…` : first || 'Пост без текста'
  const images = v.embed?.images ?? v.embed?.media?.images ?? []
  for (const img of images) {
    const cid = img.image?.ref?.$link
    if (cid) parts.push(`![${(img.alt ?? '').replace(/[[\]\n]/g, ' ').trim()}](${blob(cid)})`)
  }
  const ext = v.embed?.external
  if (ext?.uri?.startsWith('http')) parts.push(`[${(ext.title || ext.uri).replace(/[[\]\n]/g, ' ').trim()}](${ext.uri})`)
  // абзац-заголовок не повторяем в тексте, если после него что-то остаётся (абзацы, картинки, ссылка)
  if (text && first.length <= TITLE_MAX && parts.length > 1) parts.shift()
  if (!parts.length) return null
  const at = v.createdAt && !Number.isNaN(Date.parse(v.createdAt)) ? new Date(v.createdAt) : new Date()
  return { source_uri: r.uri, source_created_at: at, title, text: parts.join('\n\n') }
}

// ── маршруты ─────────────────────────────────────────────────────────────

export const ImportStatusBody = z.object({
  status: z.enum(['pending', 'published', 'dismissed']),
  articleUri: z.string().startsWith('at://').max(300).optional(),
})

export const ImportDraftDto = z.object({
  id: z.string(),
  sourceUri: z.string(),
  sourceCreatedAt: z.string(),
  title: z.string(),
  text: z.string().describe('markdown, как в редакторе'),
  status: z.enum(['pending', 'published', 'dismissed']),
  articleUri: z.string().nullable(),
})

const dto = (r: ImportDraftRow): z.infer<typeof ImportDraftDto> => ({
  id: r.id,
  sourceUri: r.source_uri,
  sourceCreatedAt: r.source_created_at.toISOString(),
  title: r.title,
  text: r.text,
  status: r.status,
  articleUri: r.article_uri,
})

const fail = (code: string, message: string, status: 400 | 401 | 404 = 400) => new PdsError(status, code, message)

export function mountImportRoutes(
  app: Hono,
  d: { pds: PdsClient; identities: IdentityRepo; imports: ImportRepo; source: PostSource },
  h: { bearer(c: Context): string | undefined },
) {
  const session = async (c: Context) => {
    const token = h.bearer(c)
    if (!token) throw fail('AuthenticationRequired', 'Нужно войти', 401)
    c.header('cache-control', 'private, no-store')
    return (await d.pds.getSession(token)).did
  }

  /** читает посты привязанного AT-аккаунта и добавляет новые в черновики */
  app.post('/me/imports/atproto', async (c) => {
    const did = await session(c)
    const source = (await d.identities.listByDid(did)).find((i) => i.provider === 'atproto')
    if (!source) throw fail('NotLinked', 'Сначала привяжите AT-аккаунт в настройках → «Связанные аккаунты»', 404)
    const drafts: NewImportDraft[] = []
    let cursor: string | undefined
    let seen = 0
    for (let i = 0; i < MAX_PAGES; i++) {
      const page = await d.source.posts(source.providerUserId, cursor)
      seen += page.records.length
      for (const r of page.records) {
        const draft = postToDraft(source.providerUserId, page.pds, r)
        if (draft) drafts.push({ ...draft, id: `imp_${randomBytes(9).toString('base64url')}`, did })
      }
      cursor = page.cursor
      if (!cursor || !page.records.length) break
    }
    const added = await d.imports.insertMany(drafts)
    return c.json({ added, seen, complete: !cursor })
  })

  app.get('/me/imports', async (c) => {
    const did = await session(c)
    const raw = c.req.query('status')
    const status = raw === 'pending' || raw === 'published' || raw === 'dismissed' ? raw : null
    return c.json({ drafts: (await d.imports.list(did, status)).map(dto) })
  })

  app.get('/me/imports/:id', async (c) => {
    const did = await session(c)
    const row = await d.imports.get(did, c.req.param('id'))
    if (!row) throw fail('NotFound', 'Черновик не найден', 404)
    return c.json(dto(row))
  })

  /** выпущен (articleUri — опубликованная статья), отклонён или возвращён в черновики */
  app.patch('/me/imports/:id', async (c) => {
    const did = await session(c)
    const body = ImportStatusBody.safeParse(await c.req.json().catch(() => null))
    if (!body.success) throw fail('InvalidRequest', z.prettifyError(body.error))
    const row = await d.imports.setStatus(did, c.req.param('id'), body.data.status, body.data.status === 'published' ? (body.data.articleUri ?? null) : null)
    if (!row) throw fail('NotFound', 'Черновик не найден', 404)
    return c.json(dto(row))
  })
}
