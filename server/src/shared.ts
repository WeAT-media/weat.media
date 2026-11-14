import { randomBytes } from 'node:crypto'
import type { Context, Hono } from 'hono'
import * as Y from 'yjs'
import { z } from 'zod'
import type { Sql, UserRepo } from './db.js'
import type { DraftRepo } from './drafts.js'
import { PdsError, type PdsClient } from './pds.js'

/**
 * Совместное редактирование черновика по ссылке /shared-draft/<token>:
 * - ссылку создаёт автор, живёт 24 ч; открыть и править может любой вошедший пользователь этого контура;
 * - документ — Yjs: клиенты шлют обновления и забирают чужие (опрос раз в ~1,5 с), сервер хранит журнал
 *   и время от времени сжимает его в одно состояние;
 * - кто менял текст (не автор) — рецензент черновика: при публикации попадает в запись статьи (reviewers);
 * - текст черновика (markdown) обновляет любой участник — у автора черновик всегда свежий.
 */

export const SHARE_TTL_MS = 24 * 3600_000
const MAX_UPDATE_BYTES = 512 * 1024
const COMPACT_EVERY = 200

export interface SharedRow { token: string; draft_id: string; owner_did: string; created_at: Date; expires_at: Date }

export interface SharedRepo {
  create(token: string, draftId: string, owner: string, expiresAt: Date): Promise<SharedRow>
  /** действующая ссылка черновика (последняя) */
  activeFor(draftId: string): Promise<SharedRow | undefined>
  get(token: string): Promise<SharedRow | undefined>
  updates(token: string, after: number): Promise<{ seq: number; data: Uint8Array }[]>
  hasUpdates(token: string): Promise<boolean>
  append(token: string, did: string, data: Uint8Array): Promise<number>
  /** журнал до seq включительно → одно обновление */
  compact(token: string, upto: number, merged: Uint8Array): Promise<void>
  addReviewer(draftId: string, did: string): Promise<void>
  reviewers(draftId: string): Promise<string[]>
  /** после публикации: ссылки черновика закрываются */
  closeFor(draftId: string): Promise<void>
}

export function sharedRepo(sql: Sql): SharedRepo {
  return {
    async create(token, draftId, owner, expiresAt) {
      const [r] = await sql<SharedRow[]>`INSERT INTO shared_drafts (token, draft_id, owner_did, expires_at) VALUES (${token}, ${draftId}, ${owner}, ${expiresAt}) RETURNING *`
      return r!
    },
    async activeFor(draftId) {
      const [r] = await sql<SharedRow[]>`SELECT * FROM shared_drafts WHERE draft_id = ${draftId} AND expires_at > now() ORDER BY expires_at DESC LIMIT 1`
      return r
    },
    async get(token) {
      const [r] = await sql<SharedRow[]>`SELECT * FROM shared_drafts WHERE token = ${token}`
      return r
    },
    async updates(token, after) {
      const rows = await sql<{ seq: string; data: Buffer }[]>`SELECT seq, data FROM shared_draft_updates WHERE token = ${token} AND seq > ${after} ORDER BY seq LIMIT 500`
      return rows.map((r) => ({ seq: Number(r.seq), data: new Uint8Array(r.data) }))
    },
    async hasUpdates(token) {
      return (await sql`SELECT 1 FROM shared_draft_updates WHERE token = ${token} LIMIT 1`).length > 0
    },
    async append(token, did, data) {
      const [r] = await sql<{ seq: string }[]>`INSERT INTO shared_draft_updates (token, did, data) VALUES (${token}, ${did}, ${Buffer.from(data)}) RETURNING seq`
      return Number(r!.seq)
    },
    async compact(token, upto, merged) {
      await sql.begin(async (tx) => {
        await tx`DELETE FROM shared_draft_updates WHERE token = ${token} AND seq < ${upto}`
        await tx`UPDATE shared_draft_updates SET data = ${Buffer.from(merged)} WHERE token = ${token} AND seq = ${upto}`
      })
    },
    async addReviewer(draftId, did) {
      await sql`INSERT INTO draft_reviewers (draft_id, did) VALUES (${draftId}, ${did}) ON CONFLICT DO NOTHING`
    },
    async reviewers(draftId) {
      return (await sql<{ did: string }[]>`SELECT did FROM draft_reviewers WHERE draft_id = ${draftId} ORDER BY first_at`).map((r) => r.did)
    },
    async closeFor(draftId) {
      await sql`UPDATE shared_drafts SET expires_at = now() WHERE draft_id = ${draftId} AND expires_at > now()`
    },
  }
}

/** для тестов */
export function memShared(): SharedRepo {
  const links = new Map<string, SharedRow>()
  const log: { token: string; seq: number; did: string; data: Uint8Array }[] = []
  const revs: { draftId: string; did: string }[] = []
  let seq = 0
  return {
    async create(token, draft_id, owner_did, expires_at) {
      const r = { token, draft_id, owner_did, created_at: new Date(), expires_at }
      links.set(token, r)
      return r
    },
    async activeFor(draftId) {
      return [...links.values()].filter((l) => l.draft_id === draftId && l.expires_at > new Date()).at(-1)
    },
    get: async (token) => links.get(token),
    updates: async (token, after) => log.filter((u) => u.token === token && u.seq > after).map(({ seq, data }) => ({ seq, data })),
    hasUpdates: async (token) => log.some((u) => u.token === token),
    async append(token, did, data) {
      log.push({ token, seq: ++seq, did, data })
      return seq
    },
    async compact(token, upto, merged) {
      for (let i = log.length - 1; i >= 0; i--) {
        const u = log[i]!
        if (u.token !== token) continue
        if (u.seq < upto) log.splice(i, 1)
        else if (u.seq === upto) u.data = merged
      }
    },
    async addReviewer(draftId, did) {
      if (!revs.some((r) => r.draftId === draftId && r.did === did)) revs.push({ draftId, did })
    },
    reviewers: async (draftId) => revs.filter((r) => r.draftId === draftId).map((r) => r.did),
    async closeFor(draftId) {
      for (const l of links.values()) if (l.draft_id === draftId && l.expires_at > new Date()) l.expires_at = new Date()
    },
  }
}

const fail = (status: 400 | 401 | 403 | 404 | 409 | 410 | 413, code: string, message: string) => new PdsError(status, code, message)

const UpdateBody = z.object({
  /** Yjs update, base64 */
  data: z.string().min(1).max(Math.ceil((MAX_UPDATE_BYTES * 4) / 3) + 4),
  /** было ли изменение руками пользователя (не загрузка документа) — тогда он рецензент */
  edited: z.boolean().default(false),
  /** первое наполнение пустой комнаты — только автор и только если журнал пуст */
  seed: z.boolean().default(false),
})
const TextBody = z.object({ title: z.string().max(300).default(''), text: z.string().max(200_000) })

export function mountSharedRoutes(app: Hono, d: { pds: PdsClient; drafts: DraftRepo; shared: SharedRepo; users: UserRepo }, h: { bearer(c: Context): string | undefined }) {
  const me = async (c: Context) => {
    const token = h.bearer(c)
    if (!token) throw fail(401, 'AuthenticationRequired', 'Совместное редактирование — только для вошедших')
    c.header('cache-control', 'private, no-store')
    return (await d.pds.getSession(token)).did
  }
  const link = async (token: string) => {
    const l = await d.shared.get(token)
    if (!l) throw fail(404, 'NotFound', 'Ссылка не найдена')
    if (l.expires_at <= new Date()) throw fail(410, 'Expired', 'Ссылка истекла: временные ссылки живут 24 часа')
    return l
  }
  const people = async (dids: string[]) =>
    Promise.all(dids.map(async (did) => {
      const u = await d.users.findByDid(did)
      return { did, handle: u?.handle ?? null, displayName: u?.display_name ?? null }
    }))

  // автор: создать ссылку (или вернуть действующую)
  app.post('/me/drafts/:id/share', async (c) => {
    const did = await me(c)
    const draft = await d.drafts.get(did, c.req.param('id'))
    if (!draft) throw fail(404, 'NotFound', 'Черновик не найден — сначала он должен сохраниться')
    const l = (await d.shared.activeFor(draft.id)) ?? (await d.shared.create(`sd_${randomBytes(12).toString('base64url')}`, draft.id, did, new Date(Date.now() + SHARE_TTL_MS)))
    return c.json({ token: l.token, expiresAt: l.expires_at.toISOString() }, 201)
  })

  // автор: действующая ссылка и рецензенты черновика
  app.get('/me/drafts/:id/share', async (c) => {
    const did = await me(c)
    const draft = await d.drafts.get(did, c.req.param('id'))
    if (!draft) throw fail(404, 'NotFound', 'Черновик не найден')
    const l = await d.shared.activeFor(draft.id)
    return c.json({ token: l?.token ?? null, expiresAt: l?.expires_at.toISOString() ?? null, reviewers: await people(await d.shared.reviewers(draft.id)) })
  })

  app.get('/shared/:token', async (c) => {
    const did = await me(c)
    const l = await link(c.req.param('token'))
    const draft = await d.drafts.get(l.owner_did, l.draft_id)
    if (!draft) throw fail(404, 'NotFound', 'Черновик удалён')
    const [owner] = await people([l.owner_did])
    return c.json({
      token: l.token,
      title: draft.title,
      text: draft.text,
      owner,
      isOwner: did === l.owner_did,
      expiresAt: l.expires_at.toISOString(),
      reviewers: await people(await d.shared.reviewers(draft.id)),
    })
  })

  app.get('/shared/:token/updates', async (c) => {
    await me(c)
    const l = await link(c.req.param('token'))
    const after = Math.max(0, Number(c.req.query('after') ?? 0) || 0)
    const list = await d.shared.updates(l.token, after)
    return c.json({ updates: list.map((u) => ({ seq: u.seq, data: Buffer.from(u.data).toString('base64') })) })
  })

  app.post('/shared/:token/updates', async (c) => {
    const did = await me(c)
    const l = await link(c.req.param('token'))
    const b = UpdateBody.safeParse(await c.req.json().catch(() => null))
    if (!b.success) throw fail(400, 'InvalidRequest', z.prettifyError(b.error))
    const data = new Uint8Array(Buffer.from(b.data.data, 'base64'))
    if (data.byteLength > MAX_UPDATE_BYTES) throw fail(413, 'TooLarge', 'Слишком большое изменение')
    try {
      Y.decodeUpdate(data)
    } catch {
      throw fail(400, 'InvalidRequest', 'Не обновление Yjs')
    }
    if (b.data.seed) {
      if (did !== l.owner_did) throw fail(403, 'Forbidden', 'Наполнить документ может только автор')
      if (await d.shared.hasUpdates(l.token)) throw fail(409, 'AlreadySeeded', 'Документ уже наполнен')
    }
    const seq = await d.shared.append(l.token, did, data)
    if (b.data.edited && did !== l.owner_did) await d.shared.addReviewer(l.draft_id, did)
    // сжатие журнала: всё до seq — в одно обновление (клиенты с after < seq получат его целиком)
    if (seq % COMPACT_EVERY === 0) {
      const all = await d.shared.updates(l.token, 0)
      if (all.length > 1) await d.shared.compact(l.token, seq, Y.mergeUpdates(all.filter((u) => u.seq <= seq).map((u) => u.data)))
    }
    return c.json({ seq }, 201)
  })

  // markdown черновика: участники держат его свежим (автор публикует из него)
  app.put('/shared/:token/text', async (c) => {
    await me(c)
    const l = await link(c.req.param('token'))
    const b = TextBody.safeParse(await c.req.json().catch(() => null))
    if (!b.success) throw fail(400, 'InvalidRequest', z.prettifyError(b.error))
    await d.drafts.save(l.owner_did, l.draft_id, b.data.title, b.data.text)
    return c.json({ ok: true })
  })
}
