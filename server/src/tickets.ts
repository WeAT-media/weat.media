import { randomBytes } from 'node:crypto'
import type { Context, Hono } from 'hono'
import { z } from 'zod'
import type { Sql, UserRepo, UserRow } from './db.js'
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
  user_seen_at?: Date | null
  created_at: Date
  updated_at: Date
}

export interface MessageRow {
  id: string
  ticket_id: string
  author: 'staff' | 'user'
  staff_sub: string | null
  text: string
  created_at: Date
}

export interface TicketRepo {
  insert(t: Omit<TicketRow, 'status' | 'staff_note' | 'updated_by' | 'created_at' | 'updated_at'>): Promise<TicketRow>
  get(id: string): Promise<TicketRow | undefined>
  list(status: TicketStatus | null, limit: number): Promise<TicketRow[]>
  update(id: string, patch: { status?: TicketStatus; staff_note?: string | null }, by: string): Promise<TicketRow | undefined>
  byDid(did: string, limit: number): Promise<TicketRow[]>
  messages(ticketIds: string[]): Promise<MessageRow[]>
  addMessage(m: Omit<MessageRow, 'created_at'>): Promise<MessageRow>
  markSeen(id: string): Promise<void>
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
    byDid(did, limit) {
      return sql<TicketRow[]>`SELECT * FROM support_tickets WHERE did = ${did} ORDER BY created_at DESC LIMIT ${limit}`
    },
    messages(ids) {
      return ids.length ? sql<MessageRow[]>`SELECT * FROM ticket_messages WHERE ticket_id = ANY(${ids}) ORDER BY created_at` : Promise.resolve([])
    },
    async addMessage(m) {
      const [row] = await sql<MessageRow[]>`
        INSERT INTO ticket_messages (id, ticket_id, author, staff_sub, text) VALUES (${m.id}, ${m.ticket_id}, ${m.author}, ${m.staff_sub}, ${m.text})
        RETURNING *`
      return row!
    },
    async markSeen(id) {
      await sql`UPDATE support_tickets SET user_seen_at = now() WHERE id = ${id}`
    },
  }
}

export const MessageBody = z.object({ text: z.string().trim().min(1).max(10_000) })

/** сотрудник пишет пользователю первым: получается обращение от поддержки */
export const DirectMessageBody = z.object({ subject: z.string().trim().min(3).max(200), text: z.string().trim().min(1).max(10_000) })

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

const messageDto = (m: MessageRow) => ({ id: m.id, author: m.author, text: m.text, createdAt: m.created_at.toISOString() })

/** заявителю: без внутренней заметки и без того, кто из сотрудников отвечал */
const ownDto = (r: TicketRow, msgs: MessageRow[]) => {
  const seen = r.user_seen_at?.getTime() ?? 0
  return {
    id: r.id,
    category: r.category,
    subject: r.subject,
    message: r.message,
    status: r.status,
    createdAt: r.created_at.toISOString(),
    messages: msgs.map(messageDto),
    unread: msgs.filter((m) => m.author === 'staff' && m.created_at.getTime() > seen).length,
  }
}

const dto = (r: TicketRow, msgs: MessageRow[] = []) => ({
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
  /** ответы дойдут до заявителя на площадке — только у обращения из вошедшего аккаунта */
  deliverable: !!r.did,
  messages: msgs.map((m) => ({ ...messageDto(m), staffSub: m.staff_sub })),
})

const fail = (code: string, message: string, status: 400 | 401 | 404) => new PdsError(status, code, message)

export function mountTicketRoutes(
  app: Hono,
  d: { pds: PdsClient; tickets: TicketRepo; users: UserRepo },
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
    const msgs = await d.tickets.messages(rows.map((r) => r.id))
    c.header('cache-control', 'private, no-store')
    return c.json(rows.map((r) => dto(r, msgs.filter((m) => m.ticket_id === r.id))))
  })

  app.get('/admin/tickets/:id', async (c) => {
    await h.requireStaff(c, 'support')
    const row = await d.tickets.get(c.req.param('id'))
    if (!row) throw fail('NotFound', 'Обращение не найдено', 404)
    c.header('cache-control', 'private, no-store')
    return c.json(dto(row, await d.tickets.messages([row.id])))
  })

  /** ответ сотрудника: обращение переходит в «Ждут ответа» (заявителя) */
  app.post('/admin/tickets/:id/messages', async (c) => {
    const staff = await h.requireStaff(c, 'support')
    const parsed = MessageBody.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) throw fail('InvalidRequest', z.prettifyError(parsed.error), 400)
    const t = await d.tickets.get(c.req.param('id'))
    if (!t) throw fail('NotFound', 'Обращение не найдено', 404)
    const by = staff === 'break-glass' ? 'break-glass' : staff.sub
    await d.tickets.addMessage({ id: `tm_${randomBytes(8).toString('base64url')}`, ticket_id: t.id, author: 'staff', staff_sub: by, text: parsed.data.text })
    const row = t.status === 'resolved' || t.status === 'rejected' ? t : (await d.tickets.update(t.id, { status: 'waiting' }, by))!
    await h.audit(staff, 'ticket.reply', t.id, { deliverable: !!t.did })
    return c.json(dto(row, await d.tickets.messages([t.id])), 201)
  })

  // ── пользователи: карточка, страны, прямое сообщение
  const adminUser = (u: UserRow) => ({
    did: u.did,
    handle: u.handle,
    displayName: u.display_name,
    tier: u.tier,
    createdAt: u.created_at.toISOString(),
    signupCountry: u.signup_country,
    residenceCountry: u.residence_country ?? u.signup_country,
    service: u.service ?? null,
  })

  app.get('/admin/users', async (c) => {
    await h.requireStaff(c, 'support')
    const rows = await d.users.search(c.req.query('q') ?? '', 100, { service: c.req.query('service') === '1' })
    c.header('cache-control', 'private, no-store')
    return c.json(rows.map(adminUser))
  })

  app.get('/admin/users/:did', async (c) => {
    await h.requireStaff(c, 'support')
    const u = await d.users.findByDid(c.req.param('did'))
    if (!u) throw fail('NotFound', 'Пользователь не найден', 404)
    const tickets = await d.tickets.byDid(u.did, 50)
    const msgs = await d.tickets.messages(tickets.map((t) => t.id))
    c.header('cache-control', 'private, no-store')
    return c.json({ ...adminUser(u), tickets: tickets.map((t) => dto(t, msgs.filter((m) => m.ticket_id === t.id))) })
  })

  /** написать пользователю напрямую: обращение от поддержки — он увидит его в «Моих обращениях» и уведомлениях */
  app.post('/admin/users/:did/messages', async (c) => {
    const staff = await h.requireStaff(c, 'support')
    const parsed = DirectMessageBody.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) throw fail('InvalidRequest', z.prettifyError(parsed.error), 400)
    const u = await d.users.findByDid(c.req.param('did'))
    if (!u) throw fail('NotFound', 'Пользователь не найден', 404)
    const by = staff === 'break-glass' ? 'break-glass' : staff.sub
    const t = await d.tickets.insert({
      id: `tk_${randomBytes(8).toString('base64url')}`,
      kind: 'support',
      category: 'staff-message',
      email: '',
      did: u.did,
      handle: u.handle,
      article_url: null,
      subject: parsed.data.subject,
      message: 'Сообщение от поддержки — ответ ниже.',
      country_from: null,
      country_to: null,
      doc_type: null,
      doc_meta: null,
    })
    await d.tickets.addMessage({ id: `tm_${randomBytes(8).toString('base64url')}`, ticket_id: t.id, author: 'staff', staff_sub: by, text: parsed.data.text })
    const row = (await d.tickets.update(t.id, { status: 'waiting' }, by))!
    await h.audit(staff, 'user.message', u.did, { ticket: t.id })
    return c.json(dto(row, await d.tickets.messages([t.id])), 201)
  })

  // ── заявитель: только свои обращения, отправленные из аккаунта
  const me = async (c: Context) => {
    const token = h.bearer(c)
    if (!token) throw fail('AuthenticationRequired', 'Нужно войти', 401)
    return (await d.pds.getSession(token)).did
  }

  app.get('/me/tickets', async (c) => {
    const did = await me(c)
    const rows = await d.tickets.byDid(did, 100)
    const msgs = await d.tickets.messages(rows.map((r) => r.id))
    c.header('cache-control', 'private, no-store')
    return c.json(rows.map((r) => ownDto(r, msgs.filter((m) => m.ticket_id === r.id))))
  })

  /** открыл обращение — ответы прочитаны */
  app.post('/me/tickets/:id/seen', async (c) => {
    const did = await me(c)
    const t = await d.tickets.get(c.req.param('id'))
    if (!t || t.did !== did) throw fail('NotFound', 'Обращение не найдено', 404)
    await d.tickets.markSeen(t.id)
    return c.json({ ok: true })
  })

  /** ответ заявителя возвращает обращение в работу */
  app.post('/me/tickets/:id/messages', async (c) => {
    const did = await me(c)
    const parsed = MessageBody.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) throw fail('InvalidRequest', z.prettifyError(parsed.error), 400)
    const t = await d.tickets.get(c.req.param('id'))
    if (!t || t.did !== did) throw fail('NotFound', 'Обращение не найдено', 404)
    await d.tickets.addMessage({ id: `tm_${randomBytes(8).toString('base64url')}`, ticket_id: t.id, author: 'user', staff_sub: null, text: parsed.data.text })
    const row = t.status === 'waiting' || t.status === 'resolved' ? (await d.tickets.update(t.id, { status: 'in_progress' }, did))! : t
    await d.tickets.markSeen(t.id)
    return c.json(ownDto(row, await d.tickets.messages([t.id])), 201)
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
    return c.json(dto(row, await d.tickets.messages([row.id])))
  })
}
