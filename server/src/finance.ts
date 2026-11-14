import { randomBytes } from 'node:crypto'
import type { Context, Hono } from 'hono'
import { z } from 'zod'
import type { UserRepo } from './db.js'
import { HOLD_DAYS, type AdjustmentRow, type PayoutRepo } from './payouts.js'
import { PdsError } from './pds.js'
import type { Staff, StaffRole } from './staff.js'

/**
 * Финансы площадки (/admin/finance, только admin): итоги продаж и комиссии по валютам, последние заказы,
 * баланс любого автора и ручные корректировки — начисление или списание с обязательной причиной.
 * Корректировки не удаляются (исправление — обратной корректировкой); каждое действие — в журнале сотрудников.
 */

export const AdjustBody = z.object({
  /** handle или DID пользователя */
  user: z.string().trim().min(3).max(300),
  /** минимальные единицы валюты, со знаком: +начисление, −списание */
  amount: z.number().int().refine((n) => n !== 0 && Math.abs(n) <= 100_000_000, 'не 0 и не больше 1 000 000 в основных единицах'),
  currency: z.enum(['RUB', 'USD', 'EUR']),
  reason: z.string().trim().min(5).max(500),
})

const adjDto = (a: AdjustmentRow) => ({ id: a.id, did: a.did, amount: a.amount, currency: a.currency.trim(), reason: a.reason, createdBy: a.created_by, createdAt: a.created_at.toISOString() })
export const AdjustmentDto = z.object({ id: z.string(), did: z.string(), amount: z.number().int(), currency: z.string(), reason: z.string(), createdBy: z.string(), createdAt: z.string() })

const fail = (code: string, message: string, status: 400 | 404 | 409 = 400) => new PdsError(status, code, message)

export function mountFinanceRoutes(
  app: Hono,
  d: { payouts: PayoutRepo; users: UserRepo },
  h: {
    requireStaff(c: Context, role: StaffRole): Promise<Staff | 'break-glass'>
    audit(who: Staff | 'break-glass', action: string, target: string | null, details?: Record<string, unknown>): Promise<void>
  },
) {
  const admin = async (c: Context) => {
    const staff = await h.requireStaff(c, 'admin')
    c.header('cache-control', 'private, no-store')
    return staff
  }

  app.get('/admin/finance/summary', async (c) => {
    await admin(c)
    const [totals, orders, adjustments] = await Promise.all([d.payouts.summary(), d.payouts.recentOrders(100), d.payouts.adjustments(null, 50)])
    return c.json({
      totals,
      orders: orders.map((o) => ({ ...o, createdAt: o.createdAt.toISOString(), paidAt: o.paidAt?.toISOString() ?? null })),
      adjustments: adjustments.map(adjDto),
    })
  })

  /** баланс конкретного пользователя — то же, что он видит в «Выплатах», плюс его корректировки */
  app.get('/admin/finance/users/:id', async (c) => {
    const staff = await admin(c)
    const user = await d.users.findByHandleOrDid(c.req.param('id'))
    if (!user) throw fail('NotFound', 'Пользователь не найден', 404)
    const [balances, adjustments] = await Promise.all([d.payouts.balances(user.did, HOLD_DAYS), d.payouts.adjustments(user.did, 100)])
    await h.audit(staff, 'finance.view_user', user.did)
    return c.json({ did: user.did, handle: user.handle, balances, adjustments: adjustments.map(adjDto) })
  })

  app.post('/admin/finance/adjustments', async (c) => {
    const staff = await admin(c)
    const body = AdjustBody.safeParse(await c.req.json().catch(() => null))
    if (!body.success) throw fail('InvalidRequest', z.prettifyError(body.error))
    const user = await d.users.findByHandleOrDid(body.data.user)
    if (!user) throw fail('NotFound', 'Пользователь не найден', 404)
    // списание не уводит доступное ниже нуля: деньги в заявках и уже выплаченные не трогаем
    if (body.data.amount < 0) {
      const b = (await d.payouts.balances(user.did, HOLD_DAYS)).find((x) => x.currency === body.data.currency)
      if (!b || b.available + body.data.amount < 0) throw fail('InsufficientBalance', 'Списание больше доступного остатка', 409)
    }
    const by = staff === 'break-glass' ? 'break-glass' : `zitadel:${staff.sub}`
    const row = await d.payouts.adjust({ id: `adj_${randomBytes(9).toString('base64url')}`, did: user.did, amount: body.data.amount, currency: body.data.currency, reason: body.data.reason, created_by: by })
    await h.audit(staff, 'finance.adjust', user.did, { amount: row.amount, currency: body.data.currency, reason: body.data.reason })
    return c.json(adjDto(row), 201)
  })
}
