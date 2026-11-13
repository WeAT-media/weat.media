import { randomBytes } from 'node:crypto'
import type { Context, Hono } from 'hono'
import { z } from 'zod'
import type { Sql } from './db.js'
import { PdsError, type PdsClient } from './pds.js'
import type { Staff, StaffRole } from './staff.js'

/**
 * Обращения в поддержку (/support/contact) и запросы органов (/support/legal).
 * Писать может любой — гость тоже (ответ на email); читать и менять статус — сотрудник с ролью support.
 * Документы не принимаем: только тип и метаданные файла, сам файл запрашивается отдельно.
 */

export type TicketStatus = 'new' | 'in_progress' | 'waiting' | 'resolved' | 'rejected'
export const TICKET_STATUSES: TicketStatus[] = ['new', 'in_progress', 'waiting', 'resolved', 'rejected']

export interface TicketRow {
  id: string
  kind: 'support' | 'legal'
  category: string
  email: string
  did: string | null
  handle: string | null
  article_url: string | null
  subject: string
  message: string
  country_from: string | null
  country_to: string | null
  doc_type: string | null
  doc_meta: { name: string; size: number; type: string } | null
  status: TicketStatus
  staff_note: string | null
  updated_by: string | null
  created_at: Date
  updated_at: Date
}

export interface TicketRepo {
  insert(t: Omit<TicketRow, 'status' | 'staff_note' | 'updated_by' | 'created_at' | 'updated_at'>): Promise<TicketRow>
  get(id: string): Promise<TicketRow | undefined>
  list(status: TicketStatus | null, limit: number): Promise<TicketRow[]>
  update(id: string, patch: { status?: TicketStatus; staff_note?: string | null }, by: string): Promise<TicketRow | undefined>
}

export function ticketRepo(sql: Sql): TicketRepo {
  return {
    async insert(t) {
      const [row] = await sql<TicketRow[]>`
        INSERT INTO support_tickets (id, kind, category, email, did, handle, article_url, subject, message, country_from, country_to, doc_type, doc_meta)
        VALUES (${t.id}, ${t.kind}, ${t.category}, ${t.email}, ${t.did}, ${t.handle}, ${t.article_url}, ${t.subject}, ${t.message},
                ${t.country_from}, ${t.country_to}, ${t.doc_type}, ${t.doc_meta ? sql.json(t.doc_meta) : null})
        RETURNING *`
      return row!
    },
    async get(id) {
      const [r] = await sql<TicketRow[]>`SELECT * FROM support_tickets WHERE id = ${id}`
      return r
    },
    list(status, limit) {
      return status
        ? sql<TicketRow[]>`SELECT * FROM support_tickets WHERE status = ${status} ORDER BY created_at DESC LIMIT ${limit}`
        : sql<TicketRow[]>`SELECT * FROM support_tickets ORDER BY created_at DESC LIMIT ${limit}`
    },
    async update(id, patch, by) {
      const [r] = await sql<TicketRow[]>`
        UPDATE support_tickets SET
          status = COALESCE(${patch.status ?? null}, status),
          staff_note = CASE WHEN ${patch.staff_note !== undefined} THEN ${patch.staff_note ?? null} ELSE staff_note END,
          updated_by = ${by}, updated_at = now()
        WHERE id = ${id} RETURNING *`
      return r
    },
  }
}

const Country = z.string().regex(/^([A-Z]{2}|other)$/)

export const TicketBody = z.object({
  kind: z.enum(['support', 'legal']).default('support'),
  category: z.string().trim().min(1).max(40),
  email: z.string().trim().email().max(254),
  handle: z.string().trim().max(253).optional(),
  articleUrl: z.string().trim().max(2000).optional(),
  subject: z.string().trim().min(3).max(200),
  message: z.string().trim().min(10).max(10_000),
  countryFrom: Country.optional(),
  countryTo: Country.optional(),
  docType: z.enum(['passport', 'registration', 'residence-permit', 'other']).optional(),
  docFile: z.object({ name: z.string().max(255), size: z.number().int().min(0).max(10 * 1024 * 1024), type: z.string().max(100) }).optional(),
})

export const TicketPatch = z
  .object({ status: z.enum(['new', 'in_progress', 'waiting', 'resolved', 'rejected']).optional(), note: z.string().max(5000).nullable().optional() })
  .refine((p) => p.status !== undefined || p.note !== undefined, 'status или note')

export const TicketDto = z.object({
  id: z.string(),
  kind: z.enum(['support', 'legal']),
  category: z.string(),
  status: z.enum(['new', 'in_progress', 'waiting', 'resolved', 'rejected']),
  createdAt: z.string(),
})

const dto = (r: TicketRow) => ({
  id: r.id,
  kind: r.kind,
  category: r.category,
  email: r.email,
  did: r.did,
  handle: r.handle,
  articleUrl: r.article_url,
  subject: r.subject,
  message: r.message,
  countryFrom: r.country_from,
  countryTo: r.country_to,
  docType: r.doc_type,
  docFile: r.doc_meta,
  status: r.status,
  staffNote: r.staff_note,
  updatedBy: r.updated_by,
  createdAt: r.created_at.toISOString(),
  updatedAt: r.updated_at.toISOString(),
})

const fail = (code: string, message: string, status: 400 | 404) => new PdsError(status, code, message)

export function mountTicketRoutes(
  app: Hono,
  d: { pds: PdsClient; tickets: TicketRepo },
  h: {
    bearer(c: Context): string | undefined
    requireStaff(c: Context, role: StaffRole): Promise<Staff | 'break-glass'>
    audit(who: Staff | 'break-glass', action: string, target: string | null, details?: Record<string, unknown>): Promise<void>
  },
) {
  /** писать может и гость; вошедшему привязываем DID — сотрудник видит, чей аккаунт */
  app.post('/support/tickets', async (c) => {
    const parsed = TicketBody.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) throw fail('InvalidRequest', z.prettifyError(parsed.error), 400)
    const b = parsed.data
    const token = h.bearer(c)
    const did = token ? await d.pds.getSession(token).then((s) => s.did, () => null) : null
    const row = await d.tickets.insert({
      id: `tk_${randomBytes(8).toString('base64url')}`,
      kind: b.kind,
      category: b.category,
      email: b.email,
      did,
      handle: b.handle || null,
      article_url: b.articleUrl || null,
      subject: b.subject,
      message: b.message,
      country_from: b.countryFrom ?? null,
      country_to: b.countryTo ?? null,
      doc_type: b.docType ?? null,
      doc_meta: b.docFile ?? null,
    })
    // заявителю — только номер и статус: содержимое видно лишь сотрудникам
    return c.json({ id: row.id, kind: row.kind, category: row.category, status: row.status, createdAt: row.created_at.toISOString() }, 201)
  })

  app.get('/admin/tickets', async (c) => {
    await h.requireStaff(c, 'support')
    const status = c.req.query('status') as TicketStatus | undefined
    const rows = await d.tickets.list(status && TICKET_STATUSES.includes(status) ? status : null, 500)
    c.header('cache-control', 'private, no-store')
    return c.json(rows.map(dto))
  })

  app.get('/admin/tickets/:id', async (c) => {
    await h.requireStaff(c, 'support')
    const row = await d.tickets.get(c.req.param('id'))
    if (!row) throw fail('NotFound', 'Обращение не найдено', 404)
    c.header('cache-control', 'private, no-store')
    return c.json(dto(row))
  })

  app.patch('/admin/tickets/:id', async (c) => {
    const staff = await h.requireStaff(c, 'support')
    const parsed = TicketPatch.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) throw fail('InvalidRequest', z.prettifyError(parsed.error), 400)
    const by = staff === 'break-glass' ? 'break-glass' : staff.sub
    const before = await d.tickets.get(c.req.param('id'))
    if (!before) throw fail('NotFound', 'Обращение не найдено', 404)
    const row = (await d.tickets.update(before.id, { status: parsed.data.status, staff_note: parsed.data.note }, by))!
    await h.audit(staff, 'ticket.update', row.id, { from: before.status, to: row.status, note: parsed.data.note !== undefined })
    return c.json(dto(row))
  })
}
