import type { Context, Hono } from 'hono'
import { z } from 'zod'
import { PdsError, type PdsClient } from './pds.js'

/**
 * Лайки статей: запись media.weat.like в репозитории читателя его же сессией.
 * Счётчики и «лайкнул ли я» читаются из индекса ленты (services/feed); без него — прямо из репозитория.
 */

export const LIKE_COLLECTION = 'media.weat.like'

const ARTICLE_URI = /^at:\/\/did:[a-z]+:[A-Za-z0-9._:%-]+\/(media\.weat\.article|site\.standard\.document)\/[A-Za-z0-9._~:-]+$/
export const LikeBody = z.object({
  subject: z.string().regex(ARTICLE_URI, 'subject: at://did/media.weat.article/rkey'),
  cid: z.string().min(1).max(200),
})

/** репозиторий читателя просматриваем не дальше этого: лайков больше — редкость, а запрос на каждый клик */
const SCAN_PAGES = 10

export const LikeRefDto = z.object({ subject: z.string(), uri: z.string().describe('запись media.weat.like') })
type LikeRef = z.infer<typeof LikeRefDto>

const fail = (code: string, message: string, status: 400 | 401) => new PdsError(status, code, message)

export function mountLikeRoutes(app: Hono, d: { pds: PdsClient; feedUrl?: string }, h: { bearer(c: Context): string | undefined }) {
  const session = async (c: Context) => {
    const token = h.bearer(c)
    if (!token) throw fail('AuthenticationRequired', 'Нужно войти', 401)
    const { did } = await d.pds.getSession(token)
    return { did, token }
  }

  /** все лайки читателя на эти статьи — по репозиторию, источнику правды */
  const scanRepo = async (did: string, subjects: Set<string>): Promise<LikeRef[]> => {
    const out: LikeRef[] = []
    let cursor: string | undefined
    for (let i = 0; i < SCAN_PAGES; i++) {
      const page = await d.pds.listRecords(did, LIKE_COLLECTION, 100, cursor)
      for (const r of page.records) {
        const subject = (r.value.subject as { uri?: unknown } | undefined)?.uri
        if (typeof subject === 'string' && subjects.has(subject)) out.push({ subject, uri: r.uri })
      }
      cursor = page.cursor
      if (!cursor || !page.records.length) break
    }
    return out
  }

  /** быстрый путь — индекс ленты; null — индекс недоступен */
  const fromIndex = async (did: string, subjects: string[]): Promise<LikeRef[] | null> => {
    if (!d.feedUrl) return null
    const q = new URLSearchParams({ did, subjects: subjects.join(',') })
    const res = await fetch(`${d.feedUrl}/feed-api/likes?${q}`, { signal: AbortSignal.timeout(3000) }).catch(() => null)
    if (!res?.ok) return null
    return ((await res.json()) as { likes: LikeRef[] }).likes
  }

  const subjectsOf = (raw: string | undefined) => [...new Set((raw ?? '').split(',').filter((u) => ARTICLE_URI.test(u)))].slice(0, 200)

  app.get('/me/likes', async (c) => {
    const s = await session(c)
    const subjects = subjectsOf(c.req.query('subjects'))
    c.header('cache-control', 'private, no-store')
    if (!subjects.length) return c.json({ likes: [] })
    const likes = (await fromIndex(s.did, subjects)) ?? (await scanRepo(s.did, new Set(subjects)))
    return c.json({ likes })
  })

  /** повторный лайк той же статьи возвращает существующую запись */
  app.post('/me/likes', async (c) => {
    const s = await session(c)
    const parsed = LikeBody.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) throw fail('InvalidRequest', z.prettifyError(parsed.error), 400)
    const { subject, cid } = parsed.data
    const existing = (await fromIndex(s.did, [subject]))?.[0] ?? (await scanRepo(s.did, new Set([subject])))[0]
    if (existing) return c.json(existing)
    const { uri } = await d.pds.createRecord(s.token, s.did, LIKE_COLLECTION, {
      $type: LIKE_COLLECTION,
      subject: { uri: subject, cid },
      createdAt: new Date().toISOString(),
    })
    return c.json({ subject, uri }, 201)
  })

  /** снимаем все лайки на статью: дубль в репозитории (гонка двух вкладок) вернул бы лайк при переиндексации */
  app.delete('/me/likes', async (c) => {
    const s = await session(c)
    const subject = c.req.query('subject') ?? ''
    if (!ARTICLE_URI.test(subject)) throw fail('InvalidRequest', 'subject: at://did/media.weat.article/rkey', 400)
    const found = await scanRepo(s.did, new Set([subject]))
    for (const l of found) await d.pds.deleteRecord(s.token, s.did, LIKE_COLLECTION, l.uri.split('/').pop()!)
    return c.json({ ok: true, removed: found.length })
  })
}
