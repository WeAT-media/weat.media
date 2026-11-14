import { randomBytes } from 'node:crypto'
import type { Context, Hono } from 'hono'
import { z } from 'zod'
import type { Sql } from './db.js'
import { PdsError, type PdsClient } from './pds.js'

/**
 * Черновики статей: личные, видит только автор. В репозиторий (он публичен) не пишутся — до публикации
 * живут в AppView; редактор сохраняет их сам, пока вы пишете, и открывает с любого устройства.
 */

export interface DraftRow {
  id: string
  did: string
  title: string
  text: string
  created_at: Date
  updated_at: Date
}

export interface DraftRepo {
  list(did: string): Promise<DraftRow[]>
  get(did: string, id: string): Promise<DraftRow | undefined>
  save(did: string, id: string, title: string, text: string): Promise<DraftRow>
  remove(did: string, id: string): Promise<boolean>
  count(did: string): Promise<number>
}

export function draftRepo(sql: Sql): DraftRepo {
  return {
    list: (did) => sql<DraftRow[]>`SELECT * FROM drafts WHERE did = ${did} ORDER BY updated_at DESC LIMIT 200`,
    async get(did, id) {
      const [r] = await sql<DraftRow[]>`SELECT * FROM drafts WHERE did = ${did} AND id = ${id}`
      return r
    },
    async save(did, id, title, text) {
      const [r] = await sql<DraftRow[]>`
        INSERT INTO drafts (id, did, title, text) VALUES (${id}, ${did}, ${title}, ${text})
        ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, text = EXCLUDED.text, updated_at = now()
        WHERE drafts.did = EXCLUDED.did
        RETURNING *`
      if (!r) throw new PdsError(404, 'NotFound', 'Черновик не найден')
      return r
    },
    async remove(did, id) {
      return (await sql`DELETE FROM drafts WHERE did = ${did} AND id = ${id} RETURNING 1`).length > 0
    },
    async count(did) {
      const [r] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM drafts WHERE did = ${did}`
      return r?.n ?? 0
    },
  }
}

export const DraftBody = z.object({ title: z.string().max(300).default(''), text: z.string().max(200_000).default('') })
export const DraftDto = z.object({ id: z.string(), title: z.string(), text: z.string(), createdAt: z.string(), updatedAt: z.string() })
export const DraftSummaryDto = z.object({ id: z.string(), title: z.string(), excerpt: z.string(), updatedAt: z.string() })

/** больше черновиков у одного автора не держим */
const MAX_DRAFTS = 200

const dto = (r: DraftRow) => ({ id: r.id, title: r.title, text: r.text, createdAt: r.created_at.toISOString(), updatedAt: r.updated_at.toISOString() })
const fail = (code: string, message: string, status: 400 | 401 | 404 | 409 = 400) => new PdsError(status, code, message)

export function mountDraftRoutes(app: Hono, d: { pds: PdsClient; drafts: DraftRepo }, h: { bearer(c: Context): string | undefined }) {
  const me = async (c: Context) => {
    const token = h.bearer(c)
    if (!token) throw fail('AuthenticationRequired', 'Нужно войти', 401)
    c.header('cache-control', 'private, no-store')
    return (await d.pds.getSession(token)).did
  }
  const body = async (c: Context) => {
    const b = DraftBody.safeParse(await c.req.json().catch(() => null))
    if (!b.success) throw fail('InvalidRequest', z.prettifyError(b.error))
    return b.data
  }

  app.get('/me/drafts', async (c) => {
    const did = await me(c)
    return c.json({
      drafts: (await d.drafts.list(did)).map((r) => ({
        id: r.id,
        title: r.title,
        excerpt: r.text.replace(/^#\s+.*\n+/, '').replace(/\s+/g, ' ').trim().slice(0, 160),
        updatedAt: r.updated_at.toISOString(),
      })),
    })
  })

  app.post('/me/drafts', async (c) => {
    const did = await me(c)
    const b = await body(c)
    if ((await d.drafts.count(did)) >= MAX_DRAFTS) throw fail('TooManyDrafts', `Черновиков больше ${MAX_DRAFTS} — удалите ненужные`, 409)
    return c.json(dto(await d.drafts.save(did, `dr_${randomBytes(9).toString('base64url')}`, b.title, b.text)), 201)
  })

  app.get('/me/drafts/:id', async (c) => {
    const did = await me(c)
    const r = await d.drafts.get(did, c.req.param('id'))
    if (!r) throw fail('NotFound', 'Черновик не найден', 404)
    return c.json(dto(r))
  })

  app.put('/me/drafts/:id', async (c) => {
    const did = await me(c)
    const b = await body(c)
    if (!(await d.drafts.get(did, c.req.param('id')))) throw fail('NotFound', 'Черновик не найден', 404)
    return c.json(dto(await d.drafts.save(did, c.req.param('id'), b.title, b.text)))
  })

  app.delete('/me/drafts/:id', async (c) => {
    const did = await me(c)
    if (!(await d.drafts.remove(did, c.req.param('id')))) throw fail('NotFound', 'Черновик не найден', 404)
    return c.json({ ok: true })
  })
}
