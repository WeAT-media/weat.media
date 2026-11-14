import type { Context, Hono } from 'hono'
import { z } from 'zod'
import { PdsError } from './pds.js'
import type { Staff, StaffRole } from './staff.js'

/**
 * Коллегии присяжных — сервис лейблеров (services/labeler, <id>.justice.weat.media).
 * Читать метки может любой (они публичны и подписаны). Ставить и снимать — сотрудник с ролью moderator:
 * AppView передаёт решение лейблеру по внутреннему адресу с LABELER_ADMIN_TOKEN, токен в браузер не попадает.
 */

export const LabelBody = z.object({
  labeler: z.enum(['spam', 'tech', 'law', 'tone', 'general']),
  uri: z.string().regex(/^(at:\/\/did:|did:)[^\s]{3,390}$/, 'uri: at://… или did:…'),
  val: z.string().regex(/^[a-z0-9.-]{3,64}$/),
  neg: z.boolean().optional(),
  /** ссылка на дело/вердикт — в журнал сотрудников */
  note: z.string().trim().max(500).optional(),
})

const fail = (code: string, message: string, status: 400 | 404 | 502 | 503 = 400) => new PdsError(status, code, message)

export function mountLabelRoutes(
  app: Hono,
  d: { labelerUrl?: string; labelerToken?: string },
  h: {
    requireStaff(c: Context, role: StaffRole): Promise<Staff | 'break-glass'>
    audit(who: Staff | 'break-glass', action: string, target: string | null, details?: Record<string, unknown>): Promise<void>
  },
) {
  const base = () => {
    if (!d.labelerUrl) throw fail('LabelerDisabled', 'Сервис коллегий не подключён', 503)
    return d.labelerUrl.replace(/\/+$/, '')
  }
  const relay = async (c: Context, path: string, init?: RequestInit) => {
    const res = await fetch(`${base()}${path}`, { ...init, signal: AbortSignal.timeout(5000) }).catch(() => null)
    if (!res) throw fail('LabelerUnavailable', 'Сервис коллегий не отвечает', 502)
    return res
  }

  /** коллегии и их значения меток */
  app.get('/labelers', async (c) => {
    const res = await relay(c, '/xrpc/app.weat.labeler.describe')
    c.header('cache-control', 'public, max-age=300')
    return c.json(await res.json(), res.ok ? 200 : 502)
  })

  /** действующие метки на записи: ?uris=at://…,at://… (до 100) */
  app.get('/labels', async (c) => {
    const uris = [...new Set((c.req.query('uris') ?? '').split(',').map((u) => u.trim()).filter((u) => /^(at:\/\/did:|did:)\S{3,390}$/.test(u)))].slice(0, 100)
    if (!uris.length) return c.json({ labels: [] })
    const res = await relay(c, `/xrpc/com.atproto.label.queryLabels?${new URLSearchParams({ uriPatterns: uris.join(','), limit: '250' })}`)
    c.header('cache-control', 'public, max-age=30')
    return c.json(res.ok ? await res.json() : { labels: [] })
  })

  app.post('/admin/labels', async (c) => {
    const staff = await h.requireStaff(c, 'moderator')
    const body = LabelBody.safeParse(await c.req.json().catch(() => null))
    if (!body.success) throw fail('InvalidRequest', z.prettifyError(body.error))
    if (!d.labelerToken) throw fail('LabelerDisabled', 'Сервис коллегий не подключён', 503)
    const { note, ...label } = body.data
    const actor = staff === 'break-glass' ? 'break-glass' : `zitadel:${staff.sub}`
    const res = await relay(c, '/admin/labels', {
      method: 'POST',
      headers: { authorization: `Bearer ${d.labelerToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ ...label, actor }),
    })
    const out = (await res.json().catch(() => ({}))) as Record<string, unknown>
    if (!res.ok) throw fail('InvalidRequest', String(out.message ?? `Сервис коллегий: ${res.status}`))
    await h.audit(staff, label.neg ? 'label.remove' : 'label.add', label.uri, { labeler: label.labeler, val: label.val, ...(note ? { note } : {}) })
    return c.json(out, 201)
  })
}
