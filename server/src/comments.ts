import type { Context, Hono } from 'hono'
import { z } from 'zod'
import { PdsError, type PdsClient } from './pds.js'
import { COMMENT_COLLECTION } from './developer.js'

/**
 * Комментарии с сайта: запись media.weat.comment в репозитории читателя его же сессией,
 * тред статьи — из индекса ленты (services/feed). Персональные токены пишут через /v1/comments.
 */

const ARTICLE_URI = /^at:\/\/did:[a-z]+:[A-Za-z0-9._:%-]+\/media\.weat\.article\/[A-Za-z0-9._~:-]+$/
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

export function mountCommentRoutes(app: Hono, d: { pds: PdsClient; feedUrl?: string }, h: { bearer(c: Context): string | undefined }) {
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
    return c.json(await res.json())
  })

  app.post('/me/comments', async (c) => {
    const s = await session(c)
    const parsed = CommentBody.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) throw fail('InvalidRequest', z.prettifyError(parsed.error), 400)
    const b = parsed.data
    const createdAt = new Date().toISOString()
    const { uri } = await d.pds.createRecord(s.token, s.did, COMMENT_COLLECTION, {
      $type: COMMENT_COLLECTION,
      subject: { uri: b.subject },
      ...(b.parent ? { reply: { parent: { uri: b.parent } } } : {}),
      text: b.text,
      createdAt,
    })
    // форма как в треде: клиент показывает комментарий сразу, не дожидаясь индекса
    return c.json({ uri, did: s.did, handle: s.handle, text: b.text, createdAt, parent: b.parent ?? null }, 201)
  })

  /** удалить можно только свой: запись живёт в репозитории автора, чужой сессией её не тронуть */
  app.delete('/me/comments/:rkey', async (c) => {
    const s = await session(c)
    const rkey = c.req.param('rkey')
    if (!RKEY.test(rkey)) throw fail('InvalidRequest', 'rkey', 400)
    await d.pds.deleteRecord(s.token, s.did, COMMENT_COLLECTION, rkey)
    return c.json({ ok: true })
  })
}
