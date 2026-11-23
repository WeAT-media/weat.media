import { randomBytes, timingSafeEqual } from 'node:crypto'
import type { Context, Hono } from 'hono'
import { z } from 'zod'
import type { Sql, UserRepo, UserRow } from './db.js'
import { PdsError, type PdsClient } from './pds.js'
import type { PaidRepo } from './paidContent.js'

/**
 * lava.top: оплата платных статей.
 * Счёт создаётся на один продукт с ценой «по запросу API» — сумму передаём сами.
 * Доступ выдаётся только по вебхуку payment.success и только после перепроверки счёта через API:
 * статус в return URL и тело вебхука можно подделать, ответ API — нет.
 */

/** доля автора: 90% обычно, 99% у Premium-автора (комиссия площадки 10% / 1%) */
export const AUTHOR_SHARE = 0.9
export const PREMIUM_AUTHOR_SHARE = 0.99

export interface LavaInvoice {
  id: string
  status: string
  paymentUrl: string | null
}

export interface LavaInvoiceInfo {
  id: string
  status: 'NEW' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED' | string
  receipt?: { amount?: number; currency?: string }
}

export interface LavaClient {
  createInvoice(body: Record<string, unknown>): Promise<LavaInvoice>
  getInvoice(id: string): Promise<LavaInvoiceInfo>
}

export function createLavaClient(apiKey: string, baseUrl = 'https://gate.lava.top'): LavaClient {
  const call = async <T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> => {
    const res = await fetch(new URL(path, baseUrl), {
      method,
      headers: { 'X-Api-Key': apiKey, accept: 'application/json', ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15_000),
    })
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
    if (!res.ok) {
      // подробности — в лог; клиенту — общий текст
      console.error('lava.top', method, path, res.status, JSON.stringify(data).slice(0, 500))
      throw new PdsError(502, 'PaymentProviderError', 'Платёжный сервис временно недоступен. Попробуйте позже.')
    }
    return data as T
  }
  return {
    createInvoice: (body) => call('POST', '/api/v3/invoice', body),
    getInvoice: (id) => call('GET', `/api/v1/invoices/${encodeURIComponent(id)}`),
  }
}

export interface OrderRow {
  id: string
  contract_id: string | null
  reader_did: string
  content_id: string
  author_did: string
  amount: number
  currency: string
  author_share: number
  platform_fee: number
  status: 'pending' | 'paid' | 'failed' | 'refunded'
  created_at: Date
  paid_at: Date | null
}

export interface OrderRepo {
  insert(o: Omit<OrderRow, 'status' | 'created_at' | 'paid_at'>): Promise<void>
  get(id: string): Promise<OrderRow | undefined>
  byContract(contractId: string): Promise<OrderRow | undefined>
  /** переход только из pending: повтор вебхука ничего не меняет */
  settle(id: string, status: 'paid' | 'failed'): Promise<boolean>
  /** возврат: только из paid; сумма уходит из баланса автора (баланс считается по status = 'paid') */
  refund(id: string): Promise<boolean>
}

export function orderRepo(sql: Sql): OrderRepo {
  return {
    async insert(o) {
      await sql`
        INSERT INTO orders (id, contract_id, reader_did, content_id, author_did, amount, currency, author_share, platform_fee)
        VALUES (${o.id}, ${o.contract_id}, ${o.reader_did}, ${o.content_id}, ${o.author_did}, ${o.amount}, ${o.currency}, ${o.author_share}, ${o.platform_fee})`
    },
    async get(id) {
      const [r] = await sql<OrderRow[]>`SELECT * FROM orders WHERE id = ${id}`
      return r
    },
    async byContract(contractId) {
      const [r] = await sql<OrderRow[]>`SELECT * FROM orders WHERE contract_id = ${contractId}`
      return r
    },
    async settle(id, status) {
      const rows = await sql`
        UPDATE orders SET status = ${status}, paid_at = CASE WHEN ${status} = 'paid' THEN now() ELSE paid_at END
        WHERE id = ${id} AND status = 'pending' RETURNING 1`
      return rows.length > 0
    },
    async refund(id) {
      return sql.begin(async (tx) => {
        const [order] = await tx<{ author_did: string }[]>`SELECT author_did FROM orders WHERE id = ${id} AND status = 'paid' FOR UPDATE`
        if (!order) return false
        await tx`SELECT pg_advisory_xact_lock(hashtext(${'payout:' + order.author_did}))`
        const rows = await tx`UPDATE orders SET status = 'refunded' WHERE id = ${id} AND status = 'paid' RETURNING 1`
        return rows.length > 0
      })
    },
  }
}

export interface PremiumOrderRow {
  id: string
  contract_id: string | null
  did: string
  amount: number
  currency: string
  days: number
  status: 'pending' | 'paid' | 'failed' | 'refunded'
  created_at: Date
  paid_at: Date | null
  paid_until: Date | null
}

export interface PremiumOrderRepo {
  insert(o: Pick<PremiumOrderRow, 'id' | 'contract_id' | 'did' | 'amount' | 'currency' | 'days'>): Promise<void>
  get(id: string): Promise<PremiumOrderRow | undefined>
  byContract(contractId: string): Promise<PremiumOrderRow | undefined>
  /** pending → paid: срок продлевается от max(now, последний оплаченный срок); повтор вебхука ничего не меняет */
  pay(id: string): Promise<PremiumOrderRow | undefined>
  fail(id: string): Promise<void>
  /** paid → refunded; возвращает пользователя, если у него не осталось оплаченного срока */
  refund(id: string): Promise<{ did: string; stillPaid: boolean } | undefined>
  /** пользователи, у которых оплаченный срок истёк (и нет более нового) — им вернуть free */
  expired(): Promise<string[]>
}

export function premiumOrderRepo(sql: Sql): PremiumOrderRepo {
  return {
    async insert(o) {
      await sql`INSERT INTO premium_orders (id, contract_id, did, amount, currency, days) VALUES (${o.id}, ${o.contract_id}, ${o.did}, ${o.amount}, ${o.currency}, ${o.days})`
    },
    async get(id) {
      const [r] = await sql<PremiumOrderRow[]>`SELECT * FROM premium_orders WHERE id = ${id}`
      return r
    },
    async byContract(contractId) {
      const [r] = await sql<PremiumOrderRow[]>`SELECT * FROM premium_orders WHERE contract_id = ${contractId}`
      return r
    },
    async pay(id) {
      const [r] = await sql<PremiumOrderRow[]>`
        UPDATE premium_orders o SET status = 'paid', paid_at = now(),
          paid_until = GREATEST(now(), COALESCE((SELECT max(p.paid_until) FROM premium_orders p WHERE p.did = o.did AND p.status = 'paid'), now()))
                       + make_interval(days => o.days)
        WHERE o.id = ${id} AND o.status = 'pending' RETURNING o.*`
      return r
    },
    async fail(id) {
      await sql`UPDATE premium_orders SET status = 'failed' WHERE id = ${id} AND status = 'pending'`
    },
    async refund(id) {
      const [r] = await sql<{ did: string }[]>`UPDATE premium_orders SET status = 'refunded' WHERE id = ${id} AND status = 'paid' RETURNING did`
      if (!r) return undefined
      const [left] = await sql`SELECT 1 FROM premium_orders WHERE did = ${r.did} AND status = 'paid' AND paid_until > now() LIMIT 1`
      return { did: r.did, stillPaid: !!left }
    },
    async expired() {
      // только те, кто получил Premium оплатой: выданный сотрудником вручную (без заказов) не трогаем
      const rows = await sql<{ did: string }[]>`
        SELECT u.did FROM users u
        WHERE u.tier = 'premium'
          AND EXISTS (SELECT 1 FROM premium_orders p WHERE p.did = u.did AND p.status = 'paid')
          AND NOT EXISTS (SELECT 1 FROM premium_orders p WHERE p.did = u.did AND p.status = 'paid' AND p.paid_until > now())`
      return rows.map((r) => r.did)
    },
  }
}

export const PurchaseBody = z.object({
  contentId: z.string().startsWith('pc_'),
  /** локальный путь, куда вернуть читателя после оплаты */
  returnTo: z.string().regex(/^\/(?![/\\])[^\s\\]*$/, 'только локальный путь').max(300).optional(),
  paymentMethod: z.enum(['CARD', 'SBP']).optional(),
  utm: z.object({ source: z.string().max(100), medium: z.string().max(100).optional(), campaign: z.string().max(100).optional() }).optional(),
})

/** Вебхук payment.* / subscription.*: плоский camelCase (PurchaseWebhookLog) */
const PurchaseWebhook = z.looseObject({
  eventType: z.string(),
  contractId: z.string(),
  amount: z.number().optional(),
  currency: z.string().optional(),
  status: z.string().optional(),
})

export interface LavaDeps {
  users: UserRepo
  pds: PdsClient
  paid: PaidRepo
  orders: OrderRepo
  premium?: { orders: PremiumOrderRepo; priceRub: number }
  lava?: LavaClient
  offerId?: string
  webhookSecret?: string
  publicUrl: string
  /** возвраты, которые не удалось сопоставить с заказом, — в журнал сотрудников для ручного разбора */
  audit?: (action: string, target: string | null, details: Record<string, unknown>) => Promise<void>
}

/** refund.success / chargeback.initiated: другая обёртка (snake_case, data), id контракта — под разными именами */
export function refundContract(raw: unknown): { event: string; contractId: string | null; data: Record<string, unknown> } | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const event = String(r.event_type ?? r.eventType ?? '')
  if (!/^(refund|chargeback)\./.test(event)) return null
  const data = (r.data && typeof r.data === 'object' ? r.data : r) as Record<string, unknown>
  const pick = (...keys: string[]) => keys.map((k) => data[k] ?? r[k]).find((v) => typeof v === 'string' && v.length > 0) as string | undefined
  return { event, contractId: pick('contract_id', 'contractId', 'parent_contract_id', 'parentContractId', 'invoice_id', 'invoiceId') ?? null, data }
}

/** оплаченный Premium — 30 дней, затем снова free (продлить — новой оплатой) */
export const PREMIUM_DAYS = 30

const fail = (code: string, message: string, status: 400 | 401 | 403 | 404 | 409 | 503) => new PdsError(status, code, message)

/** основные единицы для lava.top: 19900 копеек -> 199 */
export const toMajor = (minor: number) => Math.round(minor) / 100

export function mountLavaRoutes(app: Hono, d: LavaDeps, h: { bearer(c: Context): string | undefined }) {
  const session = async (c: Context): Promise<{ user: UserRow; email?: string }> => {
    const token = h.bearer(c)
    if (!token) throw fail('AuthenticationRequired', 'Нужно войти', 401)
    const info = await d.pds.getSession(token)
    const user = await d.users.findByDid(info.did)
    if (!user) throw fail('NotFound', 'Пользователь не найден', 404)
    return { user, email: info.email }
  }

  /** Читатель покупает статью: создаём счёт и отдаём ссылку на оплату */
  app.post('/me/purchases', async (c) => {
    if (!d.lava || !d.offerId) throw fail('PaymentsDisabled', 'Оплата пока не подключена', 503)
    const { user, email } = await session(c)
    const b = PurchaseBody.safeParse(await c.req.json().catch(() => null))
    if (!b.success) throw fail('InvalidRequest', z.prettifyError(b.error), 400)
    const content = await d.paid.get(b.data.contentId)
    if (!content) throw fail('NotFound', 'Статья не найдена', 404)
    if (content.access_type !== 'one-time' || content.price <= 0) throw fail('InvalidRequest', 'Эта статья доступна по подписке', 400)
    if (content.author_did === user.did || (await d.paid.hasAccess(user.did, content))) throw fail('AlreadyPurchased', 'Доступ уже есть', 409)
    if (!email) throw fail('EmailRequired', 'Для чека нужен email в аккаунте', 400)

    const id = `ord_${randomBytes(9).toString('base64url')}`
    const back = new URL(`/purchase/${id}`, d.publicUrl)
    if (b.data.returnTo) back.searchParams.set('returnTo', b.data.returnTo)
    // lava.top принимает только https return URL; на локальном стенде без них
    const returns = back.protocol === 'https:'
      ? { successful_return_url: back.toString(), failure_return_url: back.toString(), cancel_return_url: back.toString() }
      : {}
    const invoice = await d.lava.createInvoice({
      email,
      offerId: d.offerId,
      currency: content.currency,
      amount: toMajor(content.price),
      ...(content.currency === 'RUB' && b.data.paymentMethod === 'SBP' ? { paymentProvider: 'PAY2ME', paymentMethod: 'SBP' } : {}),
      buyerLanguage: content.currency === 'RUB' ? 'RU' : 'EN',
      ...(b.data.utm ? { clientUtm: { utm_source: b.data.utm.source, utm_medium: b.data.utm.medium, utm_campaign: b.data.utm.campaign } } : {}),
      ...returns,
    })
    const author = await d.users.findByDid(content.author_did)
    const authorShare = Math.floor(content.price * (author?.tier === 'premium' ? PREMIUM_AUTHOR_SHARE : AUTHOR_SHARE))
    await d.orders.insert({
      id,
      contract_id: invoice.id,
      reader_did: user.did,
      content_id: content.id,
      author_did: content.author_did,
      amount: content.price,
      currency: content.currency,
      author_share: authorShare,
      platform_fee: content.price - authorShare,
    })
    return c.json({ orderId: id, paymentUrl: invoice.paymentUrl }, 201)
  })

  /** Premium на 30 дней: тот же продукт «цена по запросу API», сумма — PREMIUM_PRICE_RUB. Продлить можно заранее — срок прибавится */
  app.post('/me/premium', async (c) => {
    if (!d.lava || !d.offerId || !d.premium) throw fail('PaymentsDisabled', 'Оплата пока не подключена', 503)
    const { user, email } = await session(c)
    if (!email) throw fail('EmailRequired', 'Для чека нужен email в аккаунте', 400)
    const body = (await c.req.json().catch(() => ({}))) as { paymentMethod?: unknown }
    const sbp = body?.paymentMethod === 'SBP'
    const id = `prm_${randomBytes(9).toString('base64url')}`
    const back = new URL(`/purchase/${id}`, d.publicUrl)
    back.searchParams.set('returnTo', '/after-payment')
    const returns = back.protocol === 'https:'
      ? { successful_return_url: back.toString(), failure_return_url: back.toString(), cancel_return_url: back.toString() }
      : {}
    const amount = d.premium.priceRub * 100
    const invoice = await d.lava.createInvoice({
      email,
      offerId: d.offerId,
      currency: 'RUB',
      amount: toMajor(amount),
      ...(sbp ? { paymentProvider: 'PAY2ME', paymentMethod: 'SBP' } : {}),
      buyerLanguage: 'RU',
      ...returns,
    })
    await d.premium.orders.insert({ id, contract_id: invoice.id, did: user.did, amount, currency: 'RUB', days: PREMIUM_DAYS })
    return c.json({ orderId: id, paymentUrl: invoice.paymentUrl }, 201)
  })

  /** Статус заказа для страницы возврата (читатель ждёт подтверждения вебхука) */
  app.get('/me/purchases/:id', async (c) => {
    const { user } = await session(c)
    if (c.req.param('id').startsWith('prm_')) {
      const p = await d.premium?.orders.get(c.req.param('id'))
      if (!p || p.did !== user.did) throw fail('NotFound', 'Заказ не найден', 404)
      return c.json({ orderId: p.id, status: p.status, kind: 'premium', paidUntil: p.paid_until, amount: p.amount, currency: p.currency.trim() })
    }
    const o = await d.orders.get(c.req.param('id'))
    if (!o || o.reader_did !== user.did) throw fail('NotFound', 'Заказ не найден', 404)
    return c.json({ orderId: o.id, status: o.status, contentId: o.content_id, amount: o.amount, currency: o.currency })
  })

  /**
   * Вебхук lava.top. Отвечаем 2xx быстро и на неизвестные события — иначе 20 повторов.
   * Авторизация — наш секрет в X-Api-Key (настраивается в кабинете).
   */
  app.post('/webhooks/payment', async (c) => {
    const key = c.req.header('x-api-key') ?? ''
    // длины — в байтах: ключ с не-ASCII символами той же длины в символах не должен ронять timingSafeEqual
    const kb = Buffer.from(key)
    const sb = Buffer.from(d.webhookSecret ?? '')
    const ok = !!d.webhookSecret && kb.length === sb.length && timingSafeEqual(kb, sb)
    if (!ok) return c.json({ error: 'Unauthorized' }, 401)
    const raw = await c.req.json().catch(() => null)
    const ev = PurchaseWebhook.safeParse(raw)
    if (!ev.success) {
      // refund.success / chargeback.*: доступ гасим и заказ выводим из баланса автора; не нашли заказ — в журнал
      const refund = refundContract(raw)
      if (refund) {
        const prem = refund.contractId ? await d.premium?.orders.byContract(refund.contractId) : undefined
        if (prem) {
          const r = await d.premium!.orders.refund(prem.id)
          if (r && !r.stillPaid) await d.users.setTier(r.did, 'free')
          await d.audit?.('payment.refund', prem.id, { event: refund.event, premium: true, did: prem.did, amount: prem.amount })
          return c.json({ ok: true })
        }
        const order = refund.contractId ? await d.orders.byContract(refund.contractId) : undefined
        if (order) {
          await d.orders.refund(order.id)
          await d.paid.revokeByPayment(`lava:${order.contract_id}`)
          await d.audit?.('payment.refund', order.id, { event: refund.event, author: order.author_did, amount: order.amount, currency: order.currency.trim() })
          return c.json({ ok: true })
        }
        const keep = ['refund_id', 'refund_type', 'amount', 'currency', 'customer_email', 'offer_id', 'event_id']
        await d.audit?.('payment.refund_unmatched', refund.contractId, {
          event: refund.event,
          ...Object.fromEntries(keep.filter((k) => refund.data[k] !== undefined).map((k) => [k, refund.data[k]])),
        })
        console.warn('lava refund without matching order — see staff audit', refund.event, refund.contractId)
      }
      return c.json({ ok: true })
    }
    const prem = await d.premium?.orders.byContract(ev.data.contractId)
    if (prem) {
      if (ev.data.eventType === 'payment.failed') {
        await d.premium!.orders.fail(prem.id)
        return c.json({ ok: true })
      }
      if (ev.data.eventType !== 'payment.success') return c.json({ ok: true })
      const inv = await d.lava!.getInvoice(prem.contract_id!)
      const paid = inv.receipt?.amount
      if (inv.status !== 'COMPLETED' || paid === undefined || Math.round(paid * 100) < prem.amount || inv.receipt?.currency !== prem.currency.trim()) {
        console.warn('lava premium payment not confirmed', prem.id, inv.status, paid)
        return c.json({ error: 'NotConfirmed' }, 503)
      }
      if (await d.premium!.orders.pay(prem.id)) await d.users.setTier(prem.did, 'premium')
      return c.json({ ok: true })
    }
    const order = await d.orders.byContract(ev.data.contractId)
    if (!order) return c.json({ ok: true, ignored: 'unknown contract' })

    if (ev.data.eventType === 'payment.failed') {
      await d.orders.settle(order.id, 'failed')
      return c.json({ ok: true })
    }
    if (ev.data.eventType !== 'payment.success') return c.json({ ok: true })

    // перепроверка у lava.top: статус и сумма
    const inv = await d.lava!.getInvoice(order.contract_id!)
    const paidAmount = inv.receipt?.amount
    if (inv.status !== 'COMPLETED' || paidAmount === undefined || Math.round(paidAmount * 100) < order.amount || inv.receipt?.currency !== order.currency.trim()) {
      console.warn('lava payment not confirmed', order.id, inv.status, paidAmount)
      // 5xx — lava.top повторит позже, когда счёт дойдёт до COMPLETED
      return c.json({ error: 'NotConfirmed' }, 503)
    }
    await d.paid.grant({ readerDid: order.reader_did, contentId: order.content_id, source: 'purchase', paymentRef: `lava:${order.contract_id}` })
    await d.orders.settle(order.id, 'paid')
    return c.json({ ok: true })
  })
}
