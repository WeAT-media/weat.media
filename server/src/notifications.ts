import type { Context, Hono } from 'hono'
import { z } from 'zod'
import type { Sql } from './db.js'
import type { SettingsRepo } from './settings.js'
import type { UserRepo } from './db.js'
import { PdsError, type PdsClient } from './pds.js'

export type NotificationKind = 'article' | 'comment' | 'reply'

export interface NotificationDto {
  id: string
  kind: NotificationKind
  actorDid: string
  actorHandle: string
  subjectUri: string
  articleUri: string
  articleTitle: string
  createdAt: string
  readAt: string | null
}

export interface NotificationEvent {
  kind: NotificationKind
  actorDid: string
  actorHandle: string
  subjectUri: string
  articleUri: string
  articleTitle?: string
}

export interface NotificationRepo {
  subscribe(subscriberDid: string, authorDid: string): Promise<void>
  unsubscribe(subscriberDid: string, authorDid: string): Promise<void>
  subscriptions(subscriberDid: string): Promise<string[]>
  followers(authorDid: string): Promise<string[]>
  add(recipientDid: string, event: NotificationEvent): Promise<void>
  list(recipientDid: string, limit: number): Promise<NotificationDto[]>
  markRead(recipientDid: string, ids: string[]): Promise<void>
  markAllRead(recipientDid: string): Promise<void>
}

interface NotificationRow {
  id: string | number
  kind: NotificationKind
  actor_did: string
  actor_handle: string
  subject_uri: string
  article_uri: string
  article_title: string
  created_at: Date
  read_at: Date | null
}

const dto = (row: NotificationRow): NotificationDto => ({
  id: String(row.id),
  kind: row.kind,
  actorDid: row.actor_did,
  actorHandle: row.actor_handle,
  subjectUri: row.subject_uri,
  articleUri: row.article_uri,
  articleTitle: row.article_title,
  createdAt: row.created_at.toISOString(),
  readAt: row.read_at?.toISOString() ?? null,
})

export function notificationRepo(sql: Sql): NotificationRepo {
  return {
    async subscribe(subscriberDid, authorDid) {
      await sql`INSERT INTO author_subscriptions (subscriber_did, author_did) VALUES (${subscriberDid}, ${authorDid}) ON CONFLICT DO NOTHING`
    },
    async unsubscribe(subscriberDid, authorDid) {
      await sql`DELETE FROM author_subscriptions WHERE subscriber_did = ${subscriberDid} AND author_did = ${authorDid}`
    },
    async subscriptions(subscriberDid) {
      const rows = await sql<{ author_did: string }[]>`SELECT author_did FROM author_subscriptions WHERE subscriber_did = ${subscriberDid}`
      return rows.map((r) => r.author_did)
    },
    async followers(authorDid) {
      const rows = await sql<{ subscriber_did: string }[]>`SELECT subscriber_did FROM author_subscriptions WHERE author_did = ${authorDid}`
      return rows.map((r) => r.subscriber_did)
    },
    async add(recipientDid, event) {
      await sql`INSERT INTO notifications (recipient_did, kind, actor_did, actor_handle, subject_uri, article_uri, article_title)
        VALUES (${recipientDid}, ${event.kind}, ${event.actorDid}, ${event.actorHandle}, ${event.subjectUri}, ${event.articleUri}, ${event.articleTitle ?? ''})
        ON CONFLICT (recipient_did, kind, subject_uri) DO NOTHING`
    },
    async list(recipientDid, limit) {
      const rows = await sql<NotificationRow[]>`SELECT * FROM notifications WHERE recipient_did = ${recipientDid} ORDER BY created_at DESC LIMIT ${limit}`
      return rows.map(dto)
    },
    async markRead(recipientDid, ids) {
      await sql`UPDATE notifications SET read_at = COALESCE(read_at, now()) WHERE recipient_did = ${recipientDid} AND id = ANY(${ids.map(Number)}::bigint[])`
    },
    async markAllRead(recipientDid) {
      await sql`UPDATE notifications SET read_at = COALESCE(read_at, now()) WHERE recipient_did = ${recipientDid} AND read_at IS NULL`
    },
  }
}

export interface NotificationService {
  repo: NotificationRepo
  article(authorDid: string, authorHandle: string, uri: string, title: string): Promise<void>
  comment(input: { actorDid: string; actorHandle: string; uri: string; articleUri: string; articleTitle?: string; parentUri?: string }): Promise<void>
}

const enabled = async (settings: SettingsRepo, did: string, kind: NotificationKind) => {
  const { data } = await settings.get(did)
  const prefs = data.notificationPrefs
  if (!prefs) return true
  return kind === 'article' ? prefs.articles : kind === 'comment' ? prefs.comments : prefs.replies
}

export function notificationService(repo: NotificationRepo, settings: SettingsRepo): NotificationService {
  return {
    repo,
    async article(authorDid, authorHandle, uri, title) {
      const followers = await repo.followers(authorDid)
      await Promise.all(followers.filter((did) => did !== authorDid).map(async (did) => {
        if (await enabled(settings, did, 'article')) {
          await repo.add(did, { kind: 'article', actorDid: authorDid, actorHandle: authorHandle, subjectUri: uri, articleUri: uri, articleTitle: title })
        }
      }))
    },
    async comment({ actorDid, actorHandle, uri, articleUri, articleTitle, parentUri }) {
      const recipientDid = parentUri ? parentUri.split('/')[2] : articleUri.split('/')[2]
      if (!recipientDid || recipientDid === actorDid) return
      const kind = parentUri ? 'reply' : 'comment'
      if (await enabled(settings, recipientDid, kind)) {
        await repo.add(recipientDid, { kind, actorDid, actorHandle, subjectUri: uri, articleUri, articleTitle })
      }
    },
  }
}

export function memoryNotificationRepo(): NotificationRepo {
  const subscriptions = new Map<string, Set<string>>()
  const items = new Map<string, NotificationDto[]>()
  let nextId = 1
  return {
    async subscribe(subscriberDid, authorDid) {
      const set = subscriptions.get(subscriberDid) ?? new Set()
      set.add(authorDid)
      subscriptions.set(subscriberDid, set)
    },
    async unsubscribe(subscriberDid, authorDid) { subscriptions.get(subscriberDid)?.delete(authorDid) },
    async subscriptions(subscriberDid) { return [...(subscriptions.get(subscriberDid) ?? [])] },
    async followers(authorDid) { return [...subscriptions].filter(([, authors]) => authors.has(authorDid)).map(([did]) => did) },
    async add(recipientDid, event) {
      const list = items.get(recipientDid) ?? []
      if (list.some((n) => n.kind === event.kind && n.subjectUri === event.subjectUri)) return
      list.unshift({ id: String(nextId++), ...event, articleTitle: event.articleTitle ?? '', createdAt: new Date().toISOString(), readAt: null })
      items.set(recipientDid, list)
    },
    async list(recipientDid, limit) { return (items.get(recipientDid) ?? []).slice(0, limit) },
    async markRead(recipientDid, ids) {
      const wanted = new Set(ids)
      for (const n of items.get(recipientDid) ?? []) if (wanted.has(n.id)) n.readAt ??= new Date().toISOString()
    },
    async markAllRead(recipientDid) {
      for (const n of items.get(recipientDid) ?? []) n.readAt ??= new Date().toISOString()
    },
  }
}

const ReadBody = z.object({ ids: z.array(z.string().regex(/^\d+$/)).max(100) })

export function mountNotificationRoutes(
  app: Hono,
  d: { pds: PdsClient; users: UserRepo; notifications: NotificationService },
  h: { bearer(c: Context): string | undefined },
) {
  const session = async (c: Context) => {
    const token = h.bearer(c)
    if (!token) throw new PdsError(401, 'AuthenticationRequired', 'Нужно войти')
    return d.pds.getSession(token)
  }
  app.get('/me/notifications', async (c) => {
    const { did } = await session(c)
    const limit = Math.min(100, Math.max(1, Number(c.req.query('limit')) || 50))
    return c.json({ notifications: await d.notifications.repo.list(did, limit) })
  })
  app.post('/me/notifications/read', async (c) => {
    const { did } = await session(c)
    const body = ReadBody.safeParse(await c.req.json().catch(() => null))
    if (!body.success) throw new PdsError(400, 'InvalidRequest', z.prettifyError(body.error))
    await d.notifications.repo.markRead(did, body.data.ids)
    return c.json({ ok: true })
  })
  app.post('/me/notifications/read-all', async (c) => {
    const { did } = await session(c)
    await d.notifications.repo.markAllRead(did)
    return c.json({ ok: true })
  })
  app.get('/me/author-subscriptions', async (c) => {
    const { did } = await session(c)
    return c.json({ authors: await d.notifications.repo.subscriptions(did) })
  })
  app.put('/me/author-subscriptions/:authorDid', async (c) => {
    const { did } = await session(c)
    const authorDid = c.req.param('authorDid')
    if (authorDid === did) throw new PdsError(400, 'InvalidRequest', 'Нельзя подписаться на себя')
    if (!(await d.users.findByDid(authorDid))) throw new PdsError(404, 'NotFound', 'Автор не найден')
    await d.notifications.repo.subscribe(did, authorDid)
    return c.json({ ok: true })
  })
  app.delete('/me/author-subscriptions/:authorDid', async (c) => {
    const { did } = await session(c)
    await d.notifications.repo.unsubscribe(did, c.req.param('authorDid'))
    return c.json({ ok: true })
  })
}
