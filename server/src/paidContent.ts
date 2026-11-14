import { randomBytes } from 'node:crypto'
import type { Context, Hono } from 'hono'
import { z } from 'zod'
import type { Sql, UserRepo, UserRow } from './db.js'
import { PdsError, type PdsClient } from './pds.js'
import type { SecretBox } from './secretbox.js'
import type { Staff, StaffRole } from './staff.js'

/**
 * Платные статьи. AT-репозиторий автора публичен (sync.getRepo, firehose), поэтому туда
 * уходит только обложка: заголовок, тизер, условия доступа и ссылка на закрытую часть.
 * Полный текст — в этой БД, зашифрованный отдельным ключом, и отдаётся после проверки права.
 */

export const ARTICLE_COLLECTION = 'media.weat.article'

export interface PaidContentRow {
  id: string
  author_did: string
  at_uri: string | null
  title: string
  body_enc: string
  access_type: 'one-time' | 'subscription'
  price: number
  currency: string
  tier_id: string | null
  created_at: Date
  updated_at: Date
}

export interface PaidRepo {
  insert(r: Omit<PaidContentRow, 'created_at' | 'updated_at' | 'at_uri'>): Promise<void>
  setAtUri(id: string, uri: string): Promise<void>
  get(id: string): Promise<PaidContentRow | undefined>
  byAuthor(did: string): Promise<PaidContentRow[]>
  remove(id: string): Promise<void>
  /** есть ли у читателя действующее право на статью (покупка или подписка на тариф автора) */
  hasAccess(readerDid: string, c: PaidContentRow): Promise<boolean>
  /** читателей с действующей платной подпиской на автора (агрегат, без имён) */
  countSubscribers(authorDid: string): Promise<number>
  grant(g: { readerDid: string; contentId?: string; authorDid?: string; tierId?: string; source: 'purchase' | 'subscription' | 'grant'; paymentRef?: string; expiresAt?: Date }): Promise<boolean>
  /** возврат или chargeback: право, выданное этим платежом, гаснет сразу */
  revokeByPayment(paymentRef: string): Promise<number>
}

export function paidRepo(sql: Sql): PaidRepo {
  return {
    async insert(r) {
      await sql`
        INSERT INTO paid_content (id, author_did, title, body_enc, access_type, price, currency, tier_id)
        VALUES (${r.id}, ${r.author_did}, ${r.title}, ${r.body_enc}, ${r.access_type}, ${r.price}, ${r.currency}, ${r.tier_id})`
    },
    async setAtUri(id, uri) {
      await sql`UPDATE paid_content SET at_uri = ${uri}, updated_at = now() WHERE id = ${id}`
    },
    async get(id) {
      const [row] = await sql<PaidContentRow[]>`SELECT * FROM paid_content WHERE id = ${id}`
      return row
    },
    byAuthor(did) {
      return sql<PaidContentRow[]>`SELECT * FROM paid_content WHERE author_did = ${did} ORDER BY created_at DESC`
    },
    async remove(id) {
      await sql`DELETE FROM paid_content WHERE id = ${id}`
    },
    async hasAccess(readerDid, c) {
      const [row] = await sql`
        SELECT 1 FROM entitlements
        WHERE reader_did = ${readerDid}
          AND (expires_at IS NULL OR expires_at > now())
          AND (
            content_id = ${c.id}
            OR (${c.access_type} = 'subscription' AND author_did = ${c.author_did} AND (tier_id IS NULL OR tier_id = ${c.tier_id}))
          )
        LIMIT 1`
      return !!row
    },
    async countSubscribers(authorDid) {
      const [r] = await sql<{ n: number }[]>`
        SELECT count(DISTINCT reader_did)::int AS n FROM entitlements
        WHERE author_did = ${authorDid} AND content_id IS NULL AND source IN ('subscription', 'grant')
          AND (expires_at IS NULL OR expires_at > now())`
      return r?.n ?? 0
    },
    async grant(g) {
      // payment_ref уникален: повторный webhook платёжки не создаёт второе право
      const rows = await sql`
        INSERT INTO entitlements (reader_did, content_id, author_did, tier_id, source, payment_ref, expires_at)
        VALUES (${g.readerDid}, ${g.contentId ?? null}, ${g.authorDid ?? null}, ${g.tierId ?? null}, ${g.source},
                ${g.paymentRef ?? null}, ${g.expiresAt ?? null})
        ON CONFLICT (payment_ref) DO NOTHING RETURNING id`
      return rows.length > 0
    },
    async revokeByPayment(paymentRef) {
      const rows = await sql`UPDATE entitlements SET expires_at = now() WHERE payment_ref = ${paymentRef} AND (expires_at IS NULL OR expires_at > now()) RETURNING id`
      return rows.length
    },
  }
}

const Paywall = z.object({
  accessType: z.enum(['one-time', 'subscription']),
  price: z.number().int().min(0).max(100_000_000).describe('В минимальных единицах валюты (копейки, центы)'),
  currency: z.enum(['RUB', 'USD', 'EUR']).default('RUB'),
  tierId: z.string().trim().min(1).max(64).optional(),
})

export const PublishPaidBody = z
  .object({
    title: z.string().trim().min(1).max(300),
    teaser: z.string().trim().min(1).max(3000).describe('Бесплатная часть — уходит в публичный AT-репозиторий'),
    body: z.string().min(1).max(200_000).describe('Полный текст (markdown) — хранится только на площадке'),
    tags: z.array(z.string().trim().min(1).max(64)).max(20).default([]),
    langs: z.array(z.string().regex(/^[a-z]{2}(-[A-Za-z]{2})?$/)).max(3).default([]),
    paywall: Paywall,
  })
  .refine((b) => b.paywall.accessType === 'one-time' || !!b.paywall.tierId, 'для подписки нужен tierId')
  .refine((b) => b.paywall.accessType === 'subscription' || b.paywall.price > 0, 'у разовой покупки цена больше нуля')

export const GrantBody = z
  .object({
    readerDid: z.string().startsWith('did:'),
    contentId: z.string().optional(),
    authorDid: z.string().startsWith('did:').optional(),
    tierId: z.string().optional(),
    expiresAt: z.iso.datetime().optional(),
  })
  .refine((g) => g.contentId || g.authorDid, 'нужен contentId или authorDid')

export interface PaidDeps {
  users: UserRepo
  pds: PdsClient
  paid: PaidRepo
  /** ключ закрытого хранилища — отдельный от SECRETS_KEY */
  paidBox: SecretBox
  publicUrl: string
}

const fail = (code: string, message: string, status: 400 | 401 | 402 | 403 | 404) => new PdsError(status, code, message)

/** публичная обложка: ровно то, что видят все клиенты AT Protocol */
export function coverRecord(b: z.infer<typeof PublishPaidBody>, contentId: string, publicUrl: string, now = new Date()) {
  return {
    $type: ARTICLE_COLLECTION,
    title: b.title,
    text: b.teaser,
    excerpt: b.teaser.slice(0, 500),
    tags: b.tags,
    ...(b.langs.length ? { langs: b.langs } : {}),
    createdAt: now.toISOString(),
    paywall: {
      accessType: b.paywall.accessType,
      price: b.paywall.price,
      currency: b.paywall.currency,
      ...(b.paywall.tierId ? { tierId: b.paywall.tierId } : {}),
    },
    privateContent: { service: publicUrl, id: contentId },
  }
}

export function mountPaidRoutes(
  app: Hono,
  d: PaidDeps,
  h: {
    bearer(c: Context): string | undefined
    requireStaff(c: Context, role: StaffRole): Promise<Staff | 'break-glass'>
    audit(who: Staff | 'break-glass', action: string, target: string | null, details?: Record<string, unknown>): Promise<void>
  },
) {
  const session = async (c: Context, required: boolean): Promise<{ user: UserRow; token: string } | null> => {
    const token = h.bearer(c)
    if (!token) {
      if (required) throw fail('AuthenticationRequired', 'Нужно войти', 401)
      return null
    }
    const { did } = await d.pds.getSession(token)
    const user = await d.users.findByDid(did)
    if (!user) throw fail('NotFound', 'Пользователь не найден', 404)
    return { user, token }
  }
  const terms = (c: PaidContentRow) => ({
    accessType: c.access_type,
    price: c.price,
    currency: c.currency,
    ...(c.tier_id ? { tierId: c.tier_id } : {}),
  })

  /** Автор публикует платную статью: тело — в хранилище, в AT — только обложка */
  app.post('/me/articles/paid', async (c) => {
    const s = (await session(c, true))!
    const parsed = PublishPaidBody.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) throw fail('InvalidRequest', z.prettifyError(parsed.error), 400)
    const b = parsed.data
    const id = `pc_${randomBytes(9).toString('base64url')}`
    await d.paid.insert({
      id,
      author_did: s.user.did,
      title: b.title,
      body_enc: d.paidBox.seal(b.body),
      access_type: b.paywall.accessType,
      price: b.paywall.price,
      currency: b.paywall.currency,
      tier_id: b.paywall.tierId ?? null,
    })
    try {
      const { uri } = await d.pds.createRecord(s.token, s.user.did, ARTICLE_COLLECTION, coverRecord(b, id, d.publicUrl))
      await d.paid.setAtUri(id, uri)
      return c.json({ id, uri }, 201)
    } catch (err) {
      // обложку не опубликовали — закрытую часть не держим
      await d.paid.remove(id)
      throw err
    }
  })

  /** Полный текст: автору и читателям с правом доступа; остальным — 402 с условиями */
  app.get('/paid-content/:id', async (c) => {
    const content = await d.paid.get(c.req.param('id'))
    if (!content) throw fail('NotFound', 'Статья не найдена', 404)
    const s = await session(c, false)
    const allowed = !!s && (s.user.did === content.author_did || (await d.paid.hasAccess(s.user.did, content)))
    if (!allowed) {
      return c.json(
        { error: 'PaymentRequired', message: s ? 'Оформите доступ, чтобы прочитать полностью' : 'Войдите и оформите доступ', title: content.title, paywall: terms(content) },
        402,
      )
    }
    c.header('cache-control', 'private, no-store')
    return c.json({ id: content.id, title: content.title, atUri: content.at_uri, body: d.paidBox.open(content.body_enc), paywall: terms(content) })
  })

  /** Портативность: автор забирает свои платные тексты целиком */
  app.get('/me/paid-content/export', async (c) => {
    const s = (await session(c, true))!
    const rows = await d.paid.byAuthor(s.user.did)
    c.header('cache-control', 'private, no-store')
    c.header('content-disposition', 'attachment; filename="paid-content.json"')
    return c.json(
      rows.map((r) => ({ id: r.id, atUri: r.at_uri, title: r.title, body: d.paidBox.open(r.body_enc), paywall: terms(r), createdAt: r.created_at })),
    )
  })

  app.delete('/me/articles/paid/:id', async (c) => {
    const s = (await session(c, true))!
    const content = await d.paid.get(c.req.param('id'))
    if (!content || content.author_did !== s.user.did) throw fail('NotFound', 'Статья не найдена', 404)
    if (content.at_uri) {
      const rkey = content.at_uri.split('/').pop()!
      await d.pds.deleteRecord(s.token, s.user.did, ARTICLE_COLLECTION, rkey).catch(() => {})
    }
    await d.paid.remove(content.id)
    return c.json({ ok: true })
  })

  /** Выдать право вручную (поддержка, тесты). Оплаты lava.top придут webhook'ом сюда же */
  app.post('/admin/entitlements', async (c) => {
    // выдать доступ вручную — задача поддержки
    const staff = await h.requireStaff(c, 'support')
    const g = GrantBody.safeParse(await c.req.json().catch(() => null))
    if (!g.success) throw fail('InvalidRequest', z.prettifyError(g.error), 400)
    if (g.data.contentId && !(await d.paid.get(g.data.contentId))) throw fail('NotFound', 'Статья не найдена', 404)
    await d.paid.grant({ ...g.data, source: 'grant', expiresAt: g.data.expiresAt ? new Date(g.data.expiresAt) : undefined })
    await h.audit(staff, 'entitlement.grant', g.data.readerDid, { contentId: g.data.contentId, authorDid: g.data.authorDid, tierId: g.data.tierId })
    return c.json({ ok: true }, 201)
  })
}
