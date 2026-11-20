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

const PlatformBody = z.object({ contentType: z.string().trim().min(3).max(200), enabled: z.boolean() })

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
  /** suffix — подпуть и query: '', '/platforms', '/block?did=…' */
  const feed = async (method: string, suffix = '', body?: unknown) => {
    if (!d.feedUrl || !d.feedAdminToken) throw fail('NotConfigured', 'Лента standard.site не подключена (FEED_URL, FEED_ADMIN_TOKEN)', 503)
    const res = await fetch(`${d.feedUrl.replace(/\/$/, '')}/feed-api/admin/standard${suffix}`, {
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

  // ── площадки целиком (Leaflet, pckt, Offprint): документы идут в ленту без белого списка авторов
  app.get('/admin/standard/platforms', async (c) => {
    await h.requireStaff(c, 'admin')
    return c.json(await (await feed('GET', '/platforms')).json())
  })

  app.put('/admin/standard/platforms', async (c) => {
    const staff = await h.requireStaff(c, 'admin')
    const b = PlatformBody.safeParse(await c.req.json().catch(() => null))
    if (!b.success) throw fail('InvalidRequest', z.prettifyError(b.error), 400)
    await feed('PUT', '/platforms', b.data)
    await h.audit(staff, 'standard.platform', b.data.contentType, { enabled: b.data.enabled })
    return c.json({ ok: true })
  })

  // ── блок-лист: автор со спамом на площадке пропадает из ленты целиком
  app.get('/admin/standard/block', async (c) => {
    await h.requireStaff(c, 'admin')
    return c.json(await (await feed('GET', '/block')).json())
  })

  app.post('/admin/standard/block', async (c) => {
    const staff = await h.requireStaff(c, 'admin')
    const b = AllowBody.safeParse(await c.req.json().catch(() => null))
    if (!b.success) throw fail('InvalidRequest', z.prettifyError(b.error), 400)
    const did = await toDid(b.data.id)
    await feed('POST', '/block', { did, ...(b.data.note ? { note: b.data.note } : {}) })
    await h.audit(staff, 'standard.block', did, { id: b.data.id, ...(b.data.note ? { note: b.data.note } : {}) })
    return c.json({ did }, 201)
  })

  app.delete('/admin/standard/block/:did', async (c) => {
    const staff = await h.requireStaff(c, 'admin')
    const did = c.req.param('did')
    if (!DID.test(did)) throw fail('InvalidRequest', 'Нужен DID', 400)
    await feed('DELETE', `/block?${new URLSearchParams({ did })}`)
    await h.audit(staff, 'standard.unblock', did)
    return c.json({ ok: true })
  })
}
