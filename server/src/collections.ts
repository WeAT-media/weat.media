import { randomBytes } from 'node:crypto'
import type { Context, Hono } from 'hono'
import { z } from 'zod'
import type { Sql } from './db.js'
import { PdsError, type PdsClient } from './pds.js'

export interface CollectionRow {
  id: string
  did: string
  handle: string
  title: string
  description: string
  article_ids: string[]
  created_at: Date
  updated_at: Date
}

export interface CollectionRepo {
  list(did?: string): Promise<CollectionRow[]>
  get(id: string): Promise<CollectionRow | undefined>
  save(r: Pick<CollectionRow, 'id' | 'did' | 'handle' | 'title' | 'description' | 'article_ids'>): Promise<CollectionRow>
  remove(did: string, id: string): Promise<boolean>
}

export function collectionRepo(sql: Sql): CollectionRepo {
  return {
    list: (did) => sql<CollectionRow[]>`
      SELECT * FROM collections ${did ? sql`WHERE did = ${did}` : sql``}
      ORDER BY updated_at DESC LIMIT 500`,
    async get(id) {
      const [r] = await sql<CollectionRow[]>`SELECT * FROM collections WHERE id = ${id}`
      return r
    },
    async save(r) {
      const [saved] = await sql<CollectionRow[]>`
        INSERT INTO collections (id, did, handle, title, description, article_ids)
        VALUES (${r.id}, ${r.did}, ${r.handle}, ${r.title}, ${r.description}, ${sql.json(r.article_ids as never)})
        ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, description = EXCLUDED.description,
          article_ids = EXCLUDED.article_ids, updated_at = now()
        WHERE collections.did = EXCLUDED.did
        RETURNING *`
      if (!saved) throw new PdsError(404, 'NotFound', 'Подборка не найдена')
      return saved
    },
    async remove(did, id) {
      return (await sql`DELETE FROM collections WHERE id = ${id} AND did = ${did} RETURNING 1`).length > 0
    },
  }
}

export const CollectionBody = z.object({
  id: z.string().regex(/^(?:u-col|col)-[a-zA-Z0-9_-]{1,80}$/).optional(),
  title: z.string().trim().min(3).max(200),
  description: z.string().trim().max(2000).default(''),
  articleIds: z.array(z.string().min(1).max(500)).max(500).default([]),
})
export const CollectionDto = z.object({
  id: z.string(), title: z.string(), description: z.string(), authorHandle: z.string(),
  articleIds: z.array(z.string()), createdAt: z.string(), updatedAt: z.string(),
})

const dto = (r: CollectionRow) => ({
  id: r.id,
  title: r.title,
  description: r.description,
  authorHandle: r.handle,
  articleIds: Array.isArray(r.article_ids) ? r.article_ids : [],
  createdAt: r.created_at.toISOString(),
  updatedAt: r.updated_at.toISOString(),
})

export function mountCollectionRoutes(app: Hono, d: { pds: PdsClient; collections: CollectionRepo; peerUrl?: string; fetchImpl?: typeof fetch }, h: { bearer(c: Context): string | undefined }) {
  let peerCache: { at: number; items: ReturnType<typeof dto>[] } | null = null
  const peer = async () => {
    if (!d.peerUrl) return []
    if (peerCache && Date.now() - peerCache.at < 20_000) return peerCache.items
    const res = await (d.fetchImpl ?? fetch)(`${d.peerUrl.replace(/\/$/, '')}/api/peer/collections`, {
      headers: { 'x-indie-peer-hop': '1' }, signal: AbortSignal.timeout(2500),
    }).catch(() => null)
    const body = res?.ok ? await res.json().catch(() => null) : null
    const parsed = z.object({ collections: z.array(CollectionDto) }).safeParse(body)
    const items = parsed.success ? parsed.data.collections : []
    peerCache = { at: Date.now(), items }
    return items
  }
  const me = async (c: Context) => {
    const token = h.bearer(c)
    if (!token) throw new PdsError(401, 'AuthenticationRequired', 'Нужно войти')
    const session = await d.pds.getSession(token)
    return { did: session.did, handle: session.handle }
  }
  const body = async (c: Context) => {
    const parsed = CollectionBody.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) throw new PdsError(400, 'InvalidRequest', z.prettifyError(parsed.error))
    return parsed.data
  }

  app.get('/collections', async (c) => {
    c.header('cache-control', 'public, max-age=30')
    const [mine, theirs] = await Promise.all([d.collections.list(), peer()])
    return c.json({ collections: [...mine.map(dto), ...theirs.filter((item) => !mine.some((row) => row.id === item.id))] })
  })
  app.get('/collections/:id', async (c) => {
    const row = await d.collections.get(c.req.param('id'))
    if (row) return c.json(dto(row))
    const item = (await peer()).find((item) => item.id === c.req.param('id'))
    if (!item) throw new PdsError(404, 'NotFound', 'Подборка не найдена')
    return c.json(item)
  })
  app.get('/peer/collections', async (c) => {
    if (c.req.header('x-indie-peer-hop') !== '1') return c.json({ error: 'NotFound', message: 'Не найдено' }, 404)
    c.header('cache-control', 'public, max-age=10')
    return c.json({ collections: (await d.collections.list()).map(dto) })
  })
  app.get('/me/collections', async (c) => {
    const { did } = await me(c)
    return c.json({ collections: (await d.collections.list(did)).map(dto) })
  })
  app.post('/me/collections', async (c) => {
    const { did, handle } = await me(c)
    const b = await body(c)
    const row = await d.collections.save({
      id: b.id ?? `col-${randomBytes(9).toString('base64url')}`,
      did, handle, title: b.title, description: b.description, article_ids: [...new Set(b.articleIds)],
    })
    return c.json(dto(row), 201)
  })
  app.put('/me/collections/:id', async (c) => {
    const { did, handle } = await me(c)
    const b = await body(c)
    const current = await d.collections.get(c.req.param('id'))
    if (!current || current.did !== did) throw new PdsError(404, 'NotFound', 'Подборка не найдена')
    const row = await d.collections.save({
      id: current.id, did, handle, title: b.title, description: b.description, article_ids: [...new Set(b.articleIds)],
    })
    return c.json(dto(row))
  })
  app.delete('/me/collections/:id', async (c) => {
    const { did } = await me(c)
    if (!(await d.collections.remove(did, c.req.param('id')))) throw new PdsError(404, 'NotFound', 'Подборка не найдена')
    return c.json({ ok: true })
  })
}
