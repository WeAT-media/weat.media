import { randomBytes } from 'node:crypto'
import type { Context, Hono } from 'hono'
import { z } from 'zod'
import type { Sql, UserRepo, UserRow } from './db.js'
import { PdsError, type PdsClient } from './pds.js'
import { ARTICLE_COLLECTION } from './paidContent.js'
import type { Staff, StaffRole } from './staff.js'

/**
 * «Я автор оригинала»: заявка на автора источника (habr.com + ник), а не на весь репозиторий краулера.
 * Подтверждение — код в профиле на исходном сайте; решение — сотрудник (роль support).
 * Если у статьи нет автора (opennet и т. п.), заявка относится только к этой статье.
 */

export type ClaimStatus = 'pending' | 'approved' | 'rejected' | 'transferred'

export interface ClaimRow {
  id: string
  claimant_did: string
  crawler_did: string
  source_site: string
  source_author: string
  source_author_url: string | null
  article_uri: string
  code: string
  status: ClaimStatus
  note: string | null
  decision_note: string | null
  decided_by: string | null
  decided_at: Date | null
  created_at: Date
}

export interface ClaimRepo {
  /** null — на этого автора уже есть активная заявка */
  insert(c: Omit<ClaimRow, 'status' | 'decision_note' | 'decided_by' | 'decided_at' | 'created_at'>): Promise<ClaimRow | null>
  byClaimant(did: string): Promise<ClaimRow[]>
  get(id: string): Promise<ClaimRow | undefined>
  list(status: ClaimStatus | null, limit: number): Promise<ClaimRow[]>
  /** переход только из pending */
  decide(id: string, status: 'approved' | 'rejected', by: string, note: string | null): Promise<ClaimRow | undefined>
}

export function claimRepo(sql: Sql): ClaimRepo {
  return {
    async insert(c) {
      const rows = await sql<ClaimRow[]>`
        INSERT INTO ownership_claims (id, claimant_did, crawler_did, source_site, source_author, source_author_url, article_uri, code, note)
        VALUES (${c.id}, ${c.claimant_did}, ${c.crawler_did}, ${c.source_site}, ${c.source_author}, ${c.source_author_url}, ${c.article_uri}, ${c.code}, ${c.note})
        ON CONFLICT DO NOTHING RETURNING *`
      return rows[0] ?? null
    },
    byClaimant(did) {
      return sql<ClaimRow[]>`SELECT * FROM ownership_claims WHERE claimant_did = ${did} ORDER BY created_at DESC`
    },
    async get(id) {
      const [r] = await sql<ClaimRow[]>`SELECT * FROM ownership_claims WHERE id = ${id}`
      return r
    },
    list(status, limit) {
      return sql<ClaimRow[]>`
        SELECT * FROM ownership_claims WHERE ${status}::text IS NULL OR status = ${status}
        ORDER BY created_at DESC LIMIT ${limit}`
    },
    async decide(id, status, by, note) {
      const [r] = await sql<ClaimRow[]>`
        UPDATE ownership_claims SET status = ${status}, decided_by = ${by}, decision_note = ${note}, decided_at = now()
        WHERE id = ${id} AND status = 'pending' RETURNING *`
      return r
    },
  }
}

export const ClaimBody = z.object({
  articleUri: z.string().regex(/^at:\/\/did:[a-z]+:[A-Za-z0-9._:%-]+\/media\.weat\.article\/[A-Za-z0-9._~:-]+$/),
  note: z.string().trim().max(1000).optional(),
})
export const DecideBody = z.object({ note: z.string().trim().max(1000).optional() })

export const ClaimDto = z.object({
  id: z.string(),
  status: z.enum(['pending', 'approved', 'rejected', 'transferred']),
  sourceSite: z.string(),
  sourceAuthor: z.string().nullable().describe('null — заявка только на одну статью (у источника нет автора)'),
  sourceAuthorUrl: z.string().nullable(),
  articleUri: z.string(),
  code: z.string().describe('Разместить в профиле на сайте-источнике'),
  note: z.string().nullable(),
  decisionNote: z.string().nullable(),
  createdAt: z.string(),
  decidedAt: z.string().nullable(),
})

const dto = (r: ClaimRow): z.infer<typeof ClaimDto> => ({
  id: r.id,
  status: r.status,
  sourceSite: r.source_site,
  sourceAuthor: r.source_author.startsWith('article:') ? null : r.source_author,
  sourceAuthorUrl: r.source_author_url,
  articleUri: r.article_uri,
  code: r.code,
  note: r.note,
  decisionNote: r.decision_note,
  createdAt: r.created_at.toISOString(),
  decidedAt: r.decided_at?.toISOString() ?? null,
})

const fail = (code: string, message: string, status: 400 | 401 | 404 | 409) => new PdsError(status, code, message)

export function mountClaimRoutes(
  app: Hono,
  d: { users: UserRepo; pds: PdsClient; claims: ClaimRepo },
  h: {
    bearer(c: Context): string | undefined
    requireStaff(c: Context, role: StaffRole): Promise<Staff | 'break-glass'>
    audit(who: Staff | 'break-glass', action: string, target: string | null, details?: Record<string, unknown>): Promise<void>
  },
) {
  const me = async (c: Context): Promise<UserRow> => {
    const token = h.bearer(c)
    if (!token) throw fail('AuthenticationRequired', 'Нужно войти', 401)
    const user = await d.users.findByDid((await d.pds.getSession(token)).did)
    if (!user) throw fail('NotFound', 'Пользователь не найден', 404)
    return user
  }
  const parse = async <T extends z.ZodType>(c: Context, s: T): Promise<z.infer<T>> => {
    const r = s.safeParse(await c.req.json().catch(() => ({})))
    if (!r.success) throw fail('InvalidRequest', z.prettifyError(r.error), 400)
    return r.data
  }

  app.post('/me/claims', async (c) => {
    const user = await me(c)
    const b = await parse(c, ClaimBody)
    const [, , crawlerDid = '', , rkey = ''] = b.articleUri.split('/')
    const repo = await d.pds.describeRepo(crawlerDid).catch(() => null)
    if (!repo?.handle.startsWith('crawler-')) throw fail('NotImported', 'Эта статья не импортирована краулером', 400)
    const rec = await d.pds.getRecord(crawlerDid, ARTICLE_COLLECTION, rkey)
    const source = rec?.source as { site?: string; author?: string; authorUrl?: string } | undefined
    if (!source?.site) throw fail('NotFound', 'Статья не найдена', 404)
    // автора нет — заявка только на эту статью
    const author = source.author?.trim() || `article:${rkey}`
    const claim = await d.claims.insert({
      id: `cl_${randomBytes(9).toString('base64url')}`,
      claimant_did: user.did,
      crawler_did: crawlerDid,
      source_site: source.site,
      source_author: author,
      source_author_url: source.authorUrl ?? null,
      article_uri: b.articleUri,
      code: `weat-${randomBytes(5).toString('hex')}`,
      note: b.note ?? null,
    })
    if (!claim) {
      const mine = (await d.claims.byClaimant(user.did)).find((x) => x.source_site === source.site && x.source_author.toLowerCase() === author.toLowerCase() && x.status !== 'rejected')
      // своя заявка уже есть — отдаём её (идемпотентно); чужая — конфликт
      if (mine) return c.json(dto(mine))
      throw fail('AlreadyClaimed', 'На этого автора уже подана заявка. Если это вы — напишите в поддержку.', 409)
    }
    return c.json(dto(claim), 201)
  })

  app.get('/me/claims', async (c) => {
    const user = await me(c)
    return c.json((await d.claims.byClaimant(user.did)).map(dto))
  })

  // ── поддержка: проверка и решение
  app.get('/admin/claims', async (c) => {
    await h.requireStaff(c, 'support')
    const status = c.req.query('status')
    const s = status && ['pending', 'approved', 'rejected', 'transferred'].includes(status) ? (status as ClaimStatus) : null
    const rows = await d.claims.list(s, 200)
    const handles = new Map<string, string>()
    for (const r of rows) {
      if (!handles.has(r.claimant_did)) handles.set(r.claimant_did, (await d.users.findByDid(r.claimant_did))?.handle ?? r.claimant_did)
    }
    return c.json(rows.map((r) => ({ ...dto(r), claimant: { did: r.claimant_did, handle: handles.get(r.claimant_did) } })))
  })

  for (const action of ['approve', 'reject'] as const) {
    app.post(`/admin/claims/:id/${action}`, async (c) => {
      const staff = await h.requireStaff(c, 'support')
      const { note } = await parse(c, DecideBody)
      if (action === 'reject' && !note) throw fail('InvalidRequest', 'Укажите причину отказа — её увидит заявитель', 400)
      const by = staff === 'break-glass' ? 'break-glass' : `zitadel:${staff.sub}`
      const r = await d.claims.decide(c.req.param('id'), action === 'approve' ? 'approved' : 'rejected', by, note ?? null)
      if (!r) throw fail('NotFound', 'Заявка не найдена или уже рассмотрена', 404)
      await h.audit(staff, `claim.${action}`, r.id, { claimant: r.claimant_did, site: r.source_site, author: r.source_author })
      return c.json(dto(r))
    })
  }
}
