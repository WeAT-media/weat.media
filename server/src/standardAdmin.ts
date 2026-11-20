import type { Context, Hono } from 'hono'
import { z } from 'zod'
import { PdsError } from './pds.js'
import type { Staff, StaffRole } from './staff.js'

/**
 * Белый список авторов standard.site (site.standard.document: Leaflet, pckt…) для ленты.
 * Сеть открыта для всех, и в ней хватает спама — в ленту попадают только авторы, которых добавил админ.
 * Список живёт в базе ленты (services/feed, standard_allow); AppView ходит туда с FEED_ADMIN_TOKEN, токен в браузер не попадает.
 */

const fail = (error: string, message: string, status: number) => new PdsError(status, error, message)

const AllowBody = z.object({
  /** DID или handle автора */
  id: z.string().trim().min(3).max(253),
  note: z.string().trim().max(200).optional(),
})

const DID = /^did:(plc:[a-z2-7]{24}|web:[a-z0-9.-]+)$/
const HANDLE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/

export function mountStandardAdminRoutes(
  app: Hono,
  d: { feedUrl?: string; feedAdminToken?: string; handleResolverUrl?: string },
  h: {
    requireStaff(c: Context, role: StaffRole): Promise<Staff | 'break-glass'>
    audit(who: Staff | 'break-glass', action: string, target: string | null, details?: Record<string, unknown>): Promise<void>
  },
) {
  const feed = async (method: string, query = '', body?: unknown) => {
    if (!d.feedUrl || !d.feedAdminToken) throw fail('NotConfigured', 'Лента standard.site не подключена (FEED_URL, FEED_ADMIN_TOKEN)', 503)
    const res = await fetch(`${d.feedUrl.replace(/\/$/, '')}/feed-api/admin/standard${query}`, {
      method,
      headers: { authorization: `Bearer ${d.feedAdminToken}`, ...(body ? { 'content-type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(10_000),
    }).catch(() => null)
    if (!res) throw fail('UpstreamFailure', 'Сервис ленты не отвечает', 502)
    if (!res.ok) throw fail('UpstreamFailure', `Сервис ленты ответил ${res.status}`, 502)
    return res
  }

  /** handle → DID через публичный резолвер AT (handle может жить на любом PDS) */
  const toDid = async (id: string): Promise<string> => {
    const v = id.replace(/^@/, '').toLowerCase()
    if (DID.test(v)) return v
    if (!HANDLE.test(v)) throw fail('InvalidRequest', 'Нужен DID (did:plc:…, did:web:…) или handle', 400)
    const base = (d.handleResolverUrl ?? 'https://public.api.bsky.app').replace(/\/$/, '')
    const res = await fetch(`${base}/xrpc/com.atproto.identity.resolveHandle?${new URLSearchParams({ handle: v })}`, { signal: AbortSignal.timeout(10_000) }).catch(() => null)
    const did = res?.ok ? ((await res.json().catch(() => null)) as { did?: unknown } | null)?.did : undefined
    if (typeof did !== 'string' || !DID.test(did)) throw fail('NotFound', `Handle ${v} не найден`, 404)
    return did
  }

  app.get('/admin/standard', async (c) => {
    await h.requireStaff(c, 'admin')
    return c.json(await (await feed('GET')).json())
  })

  app.post('/admin/standard', async (c) => {
    const staff = await h.requireStaff(c, 'admin')
    const b = AllowBody.safeParse(await c.req.json().catch(() => null))
    if (!b.success) throw fail('InvalidRequest', z.prettifyError(b.error), 400)
    const did = await toDid(b.data.id)
    await feed('POST', '', { did, ...(b.data.note ? { note: b.data.note } : {}) })
    await h.audit(staff, 'standard.allow', did, { id: b.data.id, ...(b.data.note ? { note: b.data.note } : {}) })
    return c.json({ did }, 201)
  })

  app.delete('/admin/standard/:did', async (c) => {
    const staff = await h.requireStaff(c, 'admin')
    const did = c.req.param('did')
    if (!DID.test(did)) throw fail('InvalidRequest', 'Нужен DID', 400)
    await feed('DELETE', `?${new URLSearchParams({ did })}`)
    await h.audit(staff, 'standard.disallow', did)
    return c.json({ ok: true })
  })
}
