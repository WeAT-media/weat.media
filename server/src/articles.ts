import type { Context, Hono } from 'hono'
import { z } from 'zod'
import { PdsError, type PdsClient } from './pds.js'
import { ARTICLE_COLLECTION } from './paidContent.js'
import { plainExcerpt } from './share.js'
import type { UserRepo } from './db.js'
import type { SharedRepo } from './shared.js'
import type { DraftRepo } from './drafts.js'
import type { Cooldown } from './cooldown.js'
import type { NotificationService } from './notifications.js'

/**
 * Публикация с сайта: запись media.weat.article в репозиторий автора его же сессией.
 * Платные статьи — отдельно (/me/articles/paid: текст в закрытом хранилище), токены — /v1/articles.
 */

/** https-адрес файла; http — только для локального стенда (демо-ролик на localhost) */
const VideoUrl = z
  .string()
  .url()
  .max(2000)
  .refine((u) => {
    const { protocol, hostname } = new URL(u)
    return protocol === 'https:' || (protocol === 'http:' && (hostname === 'localhost' || hostname === '127.0.0.1'))
  }, 'url: https://…')

export const ArticleVideo = z
  .object({
    source: z.enum(['native', 'youtube', 'loom']),
    url: VideoUrl.optional(),
    videoId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/).optional(),
    title: z.string().trim().max(300).optional(),
    description: z.string().max(5000).optional(),
    duration: z.number().int().min(0).max(86_400).optional(),
    preview: z.object({ start: z.number().int().min(0), end: z.number().int().min(1) }).refine((p) => p.end > p.start, 'preview: end > start').optional(),
  })
  .refine((v) => (v.source === 'native' ? !!v.url : !!v.videoId), 'native — нужен url, youtube и loom — videoId')

export const PublishArticleBody = z
  .object({
    title: z.string().trim().min(1).max(300),
    subtitle: z.string().trim().max(300).optional(),
    text: z.string().max(200_000).describe('Markdown (формат — раздел «Формат текста статьи» на weat.media/api): ## и ### заголовки, абзацы, списки - и 1., > цитаты, ``` код, **жирный**, *курсив*, ~~зачёркнутый~~, <u>подчёркнутый</u>, [ссылка](https://…), ![картинка](https://…); свои блоки — фенсы с JSON: ```faq, ```button, ```poll, ```bookmark, ```callout, ```carousel. У видео-записи может быть пустым.'),
    excerpt: z.string().trim().max(500).optional(),
    tags: z.array(z.string().trim().min(1).max(64)).max(20).default([]),
    langs: z.array(z.string().regex(/^[a-z]{2}(-[A-Za-z]{2})?$/)).max(3).default([]),
    kind: z.enum(['text', 'video']).default('text'),
    videos: z.array(ArticleVideo).max(10).default([]),
    /** не индексировать поисковиками: страница статьи отдаёт robots noindex */
    noindex: z.boolean().optional(),
    /** черновик, из которого публикуется: его рецензенты (правили по ссылке) попадают в запись */
    draftId: z.string().max(64).optional(),
    /** перепечатка: статья уже выходила — ссылка на оригинал (даже если его удалили) и дата первой публикации */
    republished: z
      .object({
        url: z.string().url().max(2000).refine((u) => /^https?:\/\//.test(u), 'url: http(s)://…'),
        publishedAt: z
          .string()
          .datetime({ offset: true })
          .or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/))
          .refine((v) => Date.parse(v) <= Date.now() + 5 * 60_000, 'перепечатка: дата первой публикации не может быть в будущем')
          .optional(),
      })
      .optional(),
    /** отложенный пост: время выхода на сайте; в AT — через 24 ч после него */
    publishAt: z.string().datetime({ offset: true }).optional(),
  })
  .refine((b) => b.kind === 'text' || b.videos.length > 0, 'у видео-записи нужен хотя бы один ролик')
  .refine((b) => b.kind === 'video' || b.text.trim().length > 0, 'text: напишите хотя бы абзац')

const fail = (code: string, message: string, status: 400 | 401) => new PdsError(status, code, message)

/** перепечатка → source записи (без crawledAt: это не краулер, а сам автор указал оригинал) */
export function sourceOf(url: string, publishedAt?: string) {
  const day = publishedAt && /^\d{4}-\d{2}-\d{2}$/.test(publishedAt) ? `${publishedAt}T00:00:00.000Z` : publishedAt
  return { url, site: new URL(url).hostname.replace(/^www\./, ''), ...(day ? { publishedAt: new Date(day).toISOString() } : {}) }
}

export function articleRecord(b: z.infer<typeof PublishArticleBody>, now = new Date(), reviewers: { did: string; handle?: string }[] = []) {
  return {
    $type: ARTICLE_COLLECTION,
    title: b.title,
    ...(b.subtitle ? { subtitle: b.subtitle } : {}),
    text: b.text,
    excerpt: b.excerpt ?? plainExcerpt(b.text, 500),
    tags: b.tags,
    ...(b.langs.length ? { langs: b.langs } : {}),
    ...(b.kind === 'video' ? { kind: 'video', videos: b.videos } : {}),
    ...(b.noindex ? { noindex: true } : {}),
    ...(reviewers.length ? { reviewers } : {}),
    ...(b.republished ? { source: sourceOf(b.republished.url, b.republished.publishedAt) } : {}),
    createdAt: now.toISOString(),
  }
}

export function mountArticleRoutes(app: Hono, d: { pds: PdsClient; shared?: SharedRepo; users?: UserRepo; drafts?: DraftRepo; cooldown?: Cooldown; notifications?: NotificationService }, h: { bearer(c: Context): string | undefined }) {
  app.post('/me/articles', async (c) => {
    const token = h.bearer(c)
    if (!token) throw fail('AuthenticationRequired', 'Нужно войти', 401)
    const { did, handle } = await d.pds.getSession(token)
    const parsed = PublishArticleBody.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) throw fail('InvalidRequest', z.prettifyError(parsed.error), 400)
    // рецензенты — только из своего черновика (владелец проверяется), клиент их не задаёт
    const draft = parsed.data.draftId && d.drafts ? await d.drafts.get(did, parsed.data.draftId) : undefined
    const reviewers: { did: string; handle?: string }[] = []
    if (draft && d.shared) {
      for (const r of (await d.shared.reviewers(draft.id)).filter((x) => x !== did).slice(0, 20)) {
        const handle = (await d.users?.findByDid(r))?.handle
        reviewers.push({ did: r, ...(handle ? { handle } : {}) })
      }
    }
    const scheduledAt = parsed.data.publishAt ? new Date(parsed.data.publishAt) : undefined
    // createdAt — момент выхода на сайте: назначенное время или текущее
    const record = articleRecord(parsed.data, scheduledAt && scheduledAt > new Date() ? scheduledAt : new Date(), reviewers)
    // период охлаждения: 24 ч запись только на сайте — автор правит или удаляет без следа в сети
    const held = d.cooldown ? await d.cooldown.hold({ token, did, handle }, ARTICLE_COLLECTION, record, scheduledAt) : null
    if (draft && d.shared) await d.shared.closeFor(draft.id)
    if (held) {
      if (held.visible_at <= new Date()) await d.notifications?.article(did, handle, held.uri, parsed.data.title)
      return c.json({ uri: held.uri, cid: '', pendingUntil: held.publish_at.toISOString(), visibleAt: held.visible_at.toISOString() }, 201)
    }
    if (scheduledAt && scheduledAt > new Date()) throw fail('InvalidRequest', 'Отложенная публикация недоступна для этого входа', 400)
    const { uri, cid } = await d.pds.createRecord(token, did, ARTICLE_COLLECTION, record)
    await d.notifications?.article(did, handle, uri, parsed.data.title)
    return c.json({ uri, cid }, 201)
  })
}
