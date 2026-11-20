import type { Context, Hono } from 'hono'
import { z } from 'zod'
import { PdsError, type PdsClient } from './pds.js'
import { COMMENT_COLLECTION } from './developer.js'
import type { Cooldown, PendingSource } from './cooldown.js'
import type { NotificationService } from './notifications.js'

/**
 * Комментарии с сайта: запись media.weat.comment в репозитории читателя его же сессией,
 * тред статьи — из индекса ленты (services/feed). Персональные токены пишут через /v1/comments.
 */

const ARTICLE_URI = /^at:\/\/did:[a-z]+:[A-Za-z0-9._:%-]+\/(media\.weat\.article|site\.standard\.document)\/[A-Za-z0-9._~:-]+$/
const COMMENT_URI = /^at:\/\/did:[a-z]+:[A-Za-z0-9._:%-]+\/media\.weat\.comment\/[A-Za-z0-9._~:-]+$/
const RKEY = /^[A-Za-z0-9._~:-]{1,512}$/
const DID = /^did:[a-z]+:[A-Za-z0-9._:%-]{1,200}$/

export const CommentBody = z.object({
  subject: z.string().regex(ARTICLE_URI, 'subject: at://did/media.weat.article/rkey'),
  parent: z.string().regex(COMMENT_URI, 'parent: at://did/media.weat.comment/rkey').optional(),
  text: z.string().trim().min(1).max(10_000),
})

export const CommentDto = z.object({
  uri: z.string(),
  did: z.string(),
  handle: z.string().nullable(),
  text: z.string(),
  createdAt: z.string(),
  parent: z.string().nullable().describe('uri комментария, на который это ответ'),
})

export const AuthorCommentDto = z.object({
  uri: z.string(),
  text: z.string(),
  createdAt: z.string(),
  parent: z.string().nullable(),
  subject: z.string().describe('статья'),
  subjectTitle: z.string().nullable().describe('null — статьи нет в индексе'),
})

const fail = (code: string, message: string, status: 400 | 401 | 503) => new PdsError(status, code, message)

export function mountCommentRoutes(app: Hono, d: { pds: PdsClient; feedUrl?: string; cooldown?: Cooldown; pending?: PendingSource; notifications?: NotificationService }, h: { bearer(c: Context): string | undefined }) {
  const session = async (c: Context) => {
    const token = h.bearer(c)
    if (!token) throw fail('AuthenticationRequired', 'Нужно войти', 401)
    const { did, handle } = await d.pds.getSession(token)
    return { did, handle, token }
  }

  /** subject — тред статьи; author — комментарии пользователя для профиля */
  app.get('/feed/comments', async (c) => {
    const subject = c.req.query('subject')
    const author = c.req.query('author')
    if (subject ? !ARTICLE_URI.test(subject) || author : !author || !DID.test(author)) {
      throw fail('InvalidRequest', 'subject: at://did/media.weat.article/rkey или author: did:…', 400)
    }
    if (!d.feedUrl) throw fail('FeedUnavailable', 'Индекс ленты не настроен', 503)
    const q = new URLSearchParams(subject ? { subject } : { author: author! })
    const res = await fetch(`${d.feedUrl}/feed-api/comments?${q}`, { signal: AbortSignal.timeout(3000) }).catch(() => null)
    if (!res?.ok) throw fail('FeedUnavailable', 'Индекс ленты недоступен', 503)
    c.header('cache-control', 'public, max-age=5')
    const body = (await res.json()) as { comments?: { uri: string }[] }
    // комментарии в периоде охлаждения — в треде сразу (в сеть уйдут через 24 ч)
    if (d.pending && body.comments) {
      const seen = new Set(body.comments.map((x) => x.uri))
      const held = (await d.pending.list(COMMENT_COLLECTION))
        .filter((r) => !seen.has(r.uri) && (subject ? r.subject === subject : r.did === author))
        .map((r) => {
          const rec = r.record as { text?: string; reply?: { parent?: { uri?: string } } }
          return { uri: r.uri, did: r.did, handle: r.handle, text: rec.text ?? '', createdAt: r.createdAt, parent: rec.reply?.parent?.uri ?? null, subject: r.subject, pendingUntil: r.pendingUntil }
        })
      body.comments = subject ? [...body.comments, ...held.reverse()] : [...held, ...body.comments]
    }
    return c.json(body)
  })

  app.post('/me/comments', async (c) => {
    const s = await session(c)
    const parsed = CommentBody.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) throw fail('InvalidRequest', z.prettifyError(parsed.error), 400)
    const b = parsed.data
    const createdAt = new Date().toISOString()
    const record = {
      $type: COMMENT_COLLECTION,
      subject: { uri: b.subject },
      ...(b.parent ? { reply: { parent: { uri: b.parent } } } : {}),
      text: b.text,
      createdAt,
    }
    // период охлаждения: 24 ч комментарий только на сайте
    const held = d.cooldown ? await d.cooldown.hold(s, COMMENT_COLLECTION, record) : null
    const uri = held?.uri ?? (await d.pds.createRecord(s.token, s.did, COMMENT_COLLECTION, record)).uri
    await d.notifications?.comment({ actorDid: s.did, actorHandle: s.handle, uri, articleUri: b.subject, parentUri: b.parent })
    // форма как в треде: клиент показывает комментарий сразу, не дожидаясь индекса
    return c.json({ uri, did: s.did, handle: s.handle, text: b.text, createdAt, parent: b.parent ?? null, ...(held ? { pendingUntil: held.publish_at.toISOString() } : {}) }, 201)
  })

  /** удалить можно только свой: запись живёт в репозитории автора, чужой сессией её не тронуть */
  app.delete('/me/comments/:rkey', async (c) => {
    const s = await session(c)
    const rkey = c.req.param('rkey')
    if (!RKEY.test(rkey)) throw fail('InvalidRequest', 'rkey', 400)
    // ещё в охлаждении — удаляем у себя, в сеть он не уходил
    const uri = `at://${s.did}/${COMMENT_COLLECTION}/${rkey}`
    if (d.cooldown && (await d.cooldown.repo.remove(uri))) return c.json({ ok: true })
    await d.pds.deleteRecord(s.token, s.did, COMMENT_COLLECTION, rkey)
    return c.json({ ok: true })
  })
}
