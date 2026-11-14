import type { Context, Hono } from 'hono'
import { z } from 'zod'
import { PdsError, type PdsClient } from './pds.js'
import { ARTICLE_COLLECTION } from './paidContent.js'
import type { UserRepo } from './db.js'
import type { SharedRepo } from './shared.js'
import type { DraftRepo } from './drafts.js'

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
    text: z.string().max(200_000).describe('Markdown; у видео-записи может быть пустым'),
    excerpt: z.string().trim().max(500).optional(),
    tags: z.array(z.string().trim().min(1).max(64)).max(20).default([]),
    langs: z.array(z.string().regex(/^[a-z]{2}(-[A-Za-z]{2})?$/)).max(3).default([]),
    kind: z.enum(['text', 'video']).default('text'),
    videos: z.array(ArticleVideo).max(10).default([]),
    /** не индексировать поисковиками: страница статьи отдаёт robots noindex */
    noindex: z.boolean().optional(),
    /** черновик, из которого публикуется: его рецензенты (правили по ссылке) попадают в запись */
    draftId: z.string().max(64).optional(),
  })
  .refine((b) => b.kind === 'text' || b.videos.length > 0, 'у видео-записи нужен хотя бы один ролик')
  .refine((b) => b.kind === 'video' || b.text.trim().length > 0, 'text: напишите хотя бы абзац')

const fail = (code: string, message: string, status: 400 | 401) => new PdsError(status, code, message)

export function articleRecord(b: z.infer<typeof PublishArticleBody>, now = new Date(), reviewers: { did: string; handle?: string }[] = []) {
  return {
    $type: ARTICLE_COLLECTION,
    title: b.title,
    ...(b.subtitle ? { subtitle: b.subtitle } : {}),
    text: b.text,
    excerpt: b.excerpt ?? b.text.slice(0, 500),
    tags: b.tags,
    ...(b.langs.length ? { langs: b.langs } : {}),
    ...(b.kind === 'video' ? { kind: 'video', videos: b.videos } : {}),
    ...(b.noindex ? { noindex: true } : {}),
    ...(reviewers.length ? { reviewers } : {}),
    createdAt: now.toISOString(),
  }
}

export function mountArticleRoutes(app: Hono, d: { pds: PdsClient; shared?: SharedRepo; users?: UserRepo; drafts?: DraftRepo }, h: { bearer(c: Context): string | undefined }) {
  app.post('/me/articles', async (c) => {
    const token = h.bearer(c)
    if (!token) throw fail('AuthenticationRequired', 'Нужно войти', 401)
    const { did } = await d.pds.getSession(token)
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
    const { uri, cid } = await d.pds.createRecord(token, did, ARTICLE_COLLECTION, articleRecord(parsed.data, new Date(), reviewers))
    if (draft && d.shared) await d.shared.closeFor(draft.id)
    return c.json({ uri, cid }, 201)
  })
}
