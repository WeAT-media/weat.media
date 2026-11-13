import { randomBytes } from 'node:crypto'
import type { Context, Hono } from 'hono'
import { z } from 'zod'
import type { Sql } from './db.js'
import { PdsError, type PdsClient } from './pds.js'
import type { SecretBox } from './secretbox.js'
import type { Staff, StaffRole } from './staff.js'

/**
 * Выплаты авторам по реальным продажам (lava.top).
 * Заработано — доля автора в оплаченных заказах. Деньги «созревают» HOLD_DAYS: в это окно возможен возврат.
 * Доступно = созревшее − заявки (ожидающие и выплаченные). Заявку на всю доступную сумму валюты
 * отмечает выплаченной или отклоняет сотрудник (admin); отклонённая сумма снова доступна.
 */

/** дней до «доступно к выводу»: окно возвратов и спорных платежей */
export const HOLD_DAYS = 14
/** минимальная заявка, в основных единицах валюты */
export const MIN_PAYOUT: Record<string, number> = { RUB: 1000, USD: 15, EUR: 15 }

export type PayoutStatus = 'requested' | 'paid' | 'rejected'

export interface PayoutRow {
  id: string
  author_did: string
  amount: number
  currency: string
  method: 'fiat' | 'crypto'
  destination_enc: string
  destination_hint: string
  status: PayoutStatus
  staff_note: string | null
  decided_by: string | null
  created_at: Date
  decided_at: Date | null
}

/** суммы по валюте, в минимальных единицах */
export interface Balance {
  currency: string
  earned: number
  pending: number
  reserved: number
  paidOut: number
  available: number
}

export interface Sale {
  orderId: string
  title: string
  amount: number
  authorShare: number
  currency: string
  paidAt: Date
}

export interface PayoutRepo {
  balances(did: string, holdDays: number): Promise<Balance[]>
  sales(did: string, limit: number): Promise<Sale[]>
  list(did: string): Promise<PayoutRow[]>
  /** создаёт заявку, только если сумма не больше доступного (под блокировкой автора) */
  request(p: Omit<PayoutRow, 'status' | 'staff_note' | 'decided_by' | 'created_at' | 'decided_at'>, holdDays: number): Promise<PayoutRow | null>
  queue(status: PayoutStatus | null): Promise<PayoutRow[]>
  get(id: string): Promise<PayoutRow | undefined>
  decide(id: string, status: 'paid' | 'rejected', by: string, note: string | null): Promise<PayoutRow | undefined>
}

export function payoutRepo(sql: Sql): PayoutRepo {
  const balances = async (q: Sql, did: string, holdDays: number): Promise<Balance[]> => {
    const rows = await q<{ currency: string; earned: string; pending: string; reserved: string; paid_out: string }[]>`
      WITH s AS (
        SELECT currency,
               sum(author_share) AS earned,
               sum(author_share) FILTER (WHERE paid_at > now() - make_interval(days => ${holdDays})) AS pending
        FROM orders WHERE author_did = ${did} AND status = 'paid' GROUP BY currency
      ), p AS (
        SELECT currency,
               sum(amount) FILTER (WHERE status = 'requested') AS reserved,
               sum(amount) FILTER (WHERE status = 'paid') AS paid_out
        FROM payouts WHERE author_did = ${did} GROUP BY currency
      )
      SELECT coalesce(s.currency, p.currency) AS currency,
             coalesce(s.earned, 0) AS earned, coalesce(s.pending, 0) AS pending,
             coalesce(p.reserved, 0) AS reserved, coalesce(p.paid_out, 0) AS paid_out
      FROM s FULL JOIN p ON p.currency = s.currency ORDER BY 1`
    return rows.map((r) => {
      const [earned, pending, reserved, paidOut] = [r.earned, r.pending, r.reserved, r.paid_out].map(Number) as [number, number, number, number]
      return { currency: r.currency.trim(), earned, pending, reserved, paidOut, available: Math.max(0, earned - pending - reserved - paidOut) }
    })
  }
  return {
    balances: (did, holdDays) => balances(sql, did, holdDays),
    async sales(did, limit) {
      const rows = await sql<{ id: string; title: string; amount: number; author_share: number; currency: string; paid_at: Date }[]>`
        SELECT o.id, c.title, o.amount, o.author_share, o.currency, o.paid_at
        FROM orders o JOIN paid_content c ON c.id = o.content_id
        WHERE o.author_did = ${did} AND o.status = 'paid' ORDER BY o.paid_at DESC LIMIT ${limit}`
      return rows.map((r) => ({ orderId: r.id, title: r.title, amount: r.amount, authorShare: r.author_share, currency: r.currency.trim(), paidAt: r.paid_at }))
    },
    list: (did) => sql<PayoutRow[]>`SELECT * FROM payouts WHERE author_did = ${did} ORDER BY created_at DESC LIMIT 100`,
    async request(p, holdDays) {
      return sql.begin(async (tx) => {
        // две заявки одновременно не должны вместе превысить баланс
        await tx`SELECT pg_advisory_xact_lock(hashtext(${'payout:' + p.author_did}))`
        const b = (await balances(tx as unknown as Sql, p.author_did, holdDays)).find((x) => x.currency === p.currency)
        if (!b || b.available < p.amount) return null
        const [row] = await tx<PayoutRow[]>`
          INSERT INTO payouts (id, author_did, amount, currency, method, destination_enc, destination_hint)
          VALUES (${p.id}, ${p.author_did}, ${p.amount}, ${p.currency}, ${p.method}, ${p.destination_enc}, ${p.destination_hint})
          RETURNING *`
        return row ?? null
      })
    },
    queue: (status) => sql<PayoutRow[]>`
      SELECT * FROM payouts ${status ? sql`WHERE status = ${status}` : sql``} ORDER BY created_at LIMIT 200`,
    async get(id) {
      const [r] = await sql<PayoutRow[]>`SELECT * FROM payouts WHERE id = ${id}`
      return r
    },
    async decide(id, status, by, note) {
      const [r] = await sql<PayoutRow[]>`
        UPDATE payouts SET status = ${status}, decided_by = ${by}, staff_note = ${note}, decided_at = now()
        WHERE id = ${id} AND status = 'requested' RETURNING *`
      return r
    },
  }
}

// ── маршруты ─────────────────────────────────────────────────────────────

export const PayoutRequestBody = z.object({
  currency: z.enum(['RUB', 'USD', 'EUR']),
  method: z.enum(['fiat', 'crypto']),
  /** карта/счёт (fiat) или публичный адрес кошелька (crypto) с сетью */
  destination: z.string().trim().min(8).max(200),
})
export const PayoutDecisionBody = z.object({
  status: z.enum(['paid', 'rejected']),
  note: z.string().trim().max(1000).optional(),
})

export const BalanceDto = z.object({
  currency: z.string(),
  earned: z.number().int().describe('доля автора во всех оплаченных продажах'),
  pending: z.number().int().describe(`оплачено за последние ${HOLD_DAYS} дней: ещё не доступно`),
  reserved: z.number().int().describe('в заявках на выплату'),
  paidOut: z.number().int(),
  available: z.number().int(),
  minPayout: z.number().int(),
})
export const SaleDto = z.object({ orderId: z.string(), title: z.string(), amount: z.number().int(), authorShare: z.number().int(), currency: z.string(), paidAt: z.string() })
export const PayoutDto = z.object({
  id: z.string(),
  amount: z.number().int(),
  currency: z.string(),
  method: z.enum(['fiat', 'crypto']),
  destinationHint: z.string(),
  status: z.enum(['requested', 'paid', 'rejected']),
  staffNote: z.string().nullable(),
  createdAt: z.string(),
  decidedAt: z.string().nullable(),
})
export const AdminPayoutDto = PayoutDto.extend({ authorDid: z.string(), destination: z.string().describe('реквизиты целиком — только сотруднику') })

const dto = (r: PayoutRow): z.infer<typeof PayoutDto> => ({
  id: r.id,
  amount: r.amount,
  currency: r.currency.trim(),
  method: r.method,
  destinationHint: r.destination_hint,
  status: r.status,
  staffNote: r.staff_note,
  createdAt: r.created_at.toISOString(),
  decidedAt: r.decided_at?.toISOString() ?? null,
})

/** «•••• 4242» — для списков; целиком реквизиты видит только сотрудник */
const hint = (s: string) => `•••• ${s.replace(/\s+/g, '').slice(-4)}`

const fail = (code: string, message: string, status: 400 | 401 | 404 | 409 = 400) => new PdsError(status, code, message)

export function mountPayoutRoutes(
  app: Hono,
  d: { pds: PdsClient; payouts: PayoutRepo; secrets: SecretBox },
  h: {
    bearer(c: Context): string | undefined
    requireStaff(c: Context, role: StaffRole): Promise<Staff | 'break-glass'>
    audit(who: Staff | 'break-glass', action: string, target: string | null, details?: Record<string, unknown>): Promise<void>
  },
) {
  const session = async (c: Context) => {
    const token = h.bearer(c)
    if (!token) throw fail('AuthenticationRequired', 'Нужно войти', 401)
    c.header('cache-control', 'private, no-store')
    return (await d.pds.getSession(token)).did
  }

  app.get('/me/earnings', async (c) => {
    const did = await session(c)
    const [balances, sales, payouts] = await Promise.all([d.payouts.balances(did, HOLD_DAYS), d.payouts.sales(did, 50), d.payouts.list(did)])
    return c.json({
      holdDays: HOLD_DAYS,
      balances: balances.map((b) => ({ ...b, minPayout: (MIN_PAYOUT[b.currency] ?? 0) * 100 })),
      sales: sales.map((s) => ({ ...s, paidAt: s.paidAt.toISOString() })),
      payouts: payouts.map(dto),
    })
  })

  /** заявка на всю доступную сумму валюты */
  app.post('/me/payouts', async (c) => {
    const did = await session(c)
    const body = PayoutRequestBody.safeParse(await c.req.json().catch(() => null))
    if (!body.success) throw fail('InvalidRequest', 'Укажите валюту, способ и реквизиты (от 8 символов)')
    const { currency, method, destination } = body.data
    const b = (await d.payouts.balances(did, HOLD_DAYS)).find((x) => x.currency === currency)
    const min = (MIN_PAYOUT[currency] ?? 0) * 100
    if (!b || b.available < min) throw fail('BelowMinimum', `Минимальная выплата — ${min / 100} ${currency}`, 409)
    const row = await d.payouts.request(
      { id: `po_${randomBytes(9).toString('base64url')}`, author_did: did, amount: b.available, currency, method, destination_enc: d.secrets.seal(destination), destination_hint: hint(destination) },
      HOLD_DAYS,
    )
    if (!row) throw fail('BalanceChanged', 'Баланс изменился — обновите страницу', 409)
    return c.json(dto(row), 201)
  })

  app.get('/admin/payouts', async (c) => {
    const staff = await h.requireStaff(c, 'admin')
    c.header('cache-control', 'private, no-store')
    const raw = c.req.query('status')
    const status = raw === 'requested' || raw === 'paid' || raw === 'rejected' ? raw : null
    const rows = await d.payouts.queue(status)
    await h.audit(staff, 'payout.list', status, { count: rows.length })
    return c.json(rows.map((r) => ({ ...dto(r), authorDid: r.author_did, destination: d.secrets.open(r.destination_enc) })))
  })

  app.patch('/admin/payouts/:id', async (c) => {
    const staff = await h.requireStaff(c, 'admin')
    const body = PayoutDecisionBody.safeParse(await c.req.json().catch(() => null))
    if (!body.success) throw fail('InvalidRequest', z.prettifyError(body.error))
    if (body.data.status === 'rejected' && !body.data.note) throw fail('InvalidRequest', 'Укажите причину — её увидит автор')
    const by = staff === 'break-glass' ? 'break-glass' : `zitadel:${staff.sub}`
    const row = await d.payouts.decide(c.req.param('id'), body.data.status, by, body.data.note ?? null)
    if (!row) throw fail('NotFound', 'Заявка не найдена или уже рассмотрена', 404)
    await h.audit(staff, `payout.${body.data.status}`, row.id, { amount: row.amount, currency: row.currency.trim(), author: row.author_did })
    return c.json({ ...dto(row), authorDid: row.author_did, destination: d.secrets.open(row.destination_enc) })
  })
}
