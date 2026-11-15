import { plainExcerpt } from '@/lib/plainText'
import type { Article, ArticleBlock, Comment, VideoItem } from '@/types/types'
import { comments, type ThreadComment } from '@/lib/api'
import { customFenceBlock, isCustomFence } from '@/lib/customFences'
import type { RecordVideo } from '@/lib/videoLink'

/** Записи media.weat.article из /api/feed → статьи ленты */

interface FeedItem {
  uri: string
  cid: string
  did: string
  handle: string
  /** длина текста: лента отдаёт карточки без самого текста */
  textLength?: number
  /** очки ранжирования (sort=hot | best) */
  score?: number
  likeCount?: number
  commentCount?: number
  record: {
    title?: string
    text?: string
    excerpt?: string
    tags?: string[]
    langs?: string[]
    createdAt?: string
    paywall?: { accessType?: 'one-time' | 'subscription'; price?: number; currency?: 'RUB' | 'USD' | 'EUR'; tierId?: string }
    privateContent?: { id?: string }
    source?: { url?: string; site?: string; author?: string; publishedAt?: string }
    kind?: string
    videos?: RecordVideo[]
    noindex?: boolean
    reviewers?: { did?: string; handle?: string }[]
  }
  /** AppView: запись в периоде охлаждения */
  pendingUntil?: string
}

/** видео из записи → плейлист страницы; адреса — только http(s), id площадок — как в лексиконе */
function toVideos(i: FeedItem): VideoItem[] {
  return (i.record.videos ?? []).flatMap((v, n) => {
    const native = v.source === 'native'
    if (native ? !v.url || !/^https?:\/\//.test(v.url) : !v.videoId || !/^[A-Za-z0-9_-]{1,64}$/.test(v.videoId)) return []
    if (!['native', 'youtube', 'loom'].includes(v.source)) return []
    return [
      {
        id: `${i.uri}#v${n}`,
        title: v.title ?? i.record.title ?? '',
        description: v.description,
        source: v.source,
        ...(native ? { src: v.url } : { videoId: v.videoId }),
        duration: v.duration,
        // своё видео даёт площадке удержание и CTR; внешние площадки — нет
        analyticsCapabilities: { retention: native, ctr: native },
      },
    ]
  })
}

// import.meta.env?. — модуль используется и вне Vite (проверки разбора)
const BASE = import.meta.env?.VITE_API_URL ?? '/api'

/** markdown → блоки статьи: заголовки, код, цитаты, списки, абзацы */
/**
 * BlockSuite экранирует в markdown символы рядом с выделением (`**текст.**&#x20;Дальше`) — в тексте показываем
 * сами символы. Только вне блоков кода: там всё как написано.
 */
const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0' }
export const decodeEntities = (s: string) =>
  s
    .replace(/&#x([0-9a-f]{1,6});/gi, (m, h: string) => safeChar(parseInt(h, 16)) ?? m)
    .replace(/&#(\d{1,7});/g, (m, d: string) => safeChar(Number(d)) ?? m)
    .replace(/&(amp|lt|gt|quot|apos|nbsp);/g, (_m, n: string) => NAMED[n]!)
const safeChar = (code: number) => (code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : null)

export function markdownToBlocks(md: string): ArticleBlock[] {
  const blocks: ArticleBlock[] = []
  const lines = md.replace(/\r\n/g, '\n').split('\n')
  let para: string[] = []
  // картинка: ![подпись](адрес) или картинка-ссылка [![подпись](адрес)](куда)
  const IMG = /\[?!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)(?:\]\([^)]+\))?/g
  const flush = () => {
    const t = decodeEntities(para.join(' ').trim())
    para = []
    if (!t) return
    const images = [...t.matchAll(IMG)]
    const rest = t.replace(IMG, ' ').replace(/\s+/g, ' ').trim()
    if (rest) blocks.push({ type: 'p', text: rest })
    for (const m of images) blocks.push({ type: 'image', text: m[2]!, alt: m[1]!.trim() })
  }
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    const fence = /^```(\w*)/.exec(line)
    if (fence) {
      flush()
      const code: string[] = []
      while (++i < lines.length && !lines[i]!.startsWith('```')) code.push(lines[i]!)
      if (fence[1] && isCustomFence(fence[1])) {
        const block = customFenceBlock(fence[1], code.join('\n'))
        if (block) blocks.push(block)
      } else blocks.push({ type: 'code', text: code.join('\n'), ...(fence[1] ? { lang: fence[1] } : {}) })
    } else if (/^#{1,6}\s/.test(line)) {
      flush()
      blocks.push({ type: 'h2', text: decodeEntities(line.replace(/^#{1,6}\s+/, '')) })
    } else if (line.startsWith('>')) {
      flush()
      blocks.push({ type: 'quote', text: decodeEntities(line.replace(/^>\s?/, '')) })
    } else if (/^\s*[-*]\s+/.test(line)) {
      flush()
      const items = [line.replace(/^\s*[-*]\s+/, '')]
      while (i + 1 < lines.length && /^\s*[-*]\s+/.test(lines[i + 1]!)) items.push(lines[++i]!.replace(/^\s*[-*]\s+/, ''))
      blocks.push({ type: 'ul', text: decodeEntities(items.join('\n')) })
    } else if (!line.trim()) {
      flush()
    } else {
      para.push(line.trim())
    }
  }
  flush()
  return blocks
}

/** id для адреса /article/:id: rkey + хвост DID — уникален между репозиториями */
export const remoteId = (uri: string) => {
  const [, , did = '', , rkey = ''] = uri.split('/')
  return `${rkey}-${did.slice(-6)}`
}

/** якорь комментария на странице статьи: rkey + хвост DID, как у remoteId; демо-комментарии — по id */
export const commentAnchor = (id: string) => {
  if (!id.startsWith('at://')) return `c-${id}`
  const [, , did = '', , rkey = ''] = id.split('/')
  return `c-${rkey}-${did.slice(-6)}`
}

export function toArticle(i: FeedItem): Article | null {
  const r = i.record
  if (!r.title) return null
  const blocks = r.text ? markdownToBlocks(r.text) : []
  // ≈ 6 символов на слово, 200 слов в минуту
  const words = r.text ? r.text.split(/\s+/).length : Math.round((i.textLength ?? 0) / 6)
  const created = r.createdAt ?? new Date().toISOString()
  const crawled = !!r.source?.url
  const videos = toVideos(i)
  const preview = r.videos?.[0]?.preview
  return {
    id: remoteId(i.uri),
    title: r.title,
    author: { name: r.source?.author ?? i.handle.split('.')[0] ?? i.handle, handle: i.handle, did: i.did },
    publishedAt: (r.source?.publishedAt ?? created).slice(0, 10),
    // новость с источника — по времени оригинала, своя запись — по времени публикации
    publishedAtFull: r.source?.publishedAt ?? created,
    language: (r.langs?.[0]?.slice(0, 2) ?? 'ru') as Article['language'],
    tags: r.tags ?? [],
    readingTime: Math.max(1, Math.round(words / 200)),
    verdict: 'clear',
    excerpt: plainExcerpt(r.excerpt ?? blocks.find((b) => b.type === 'p')?.text ?? ''),
    blocks,
    comments: [],
    atUri: i.uri,
    ...(i.pendingUntil ? { pendingUntil: i.pendingUntil } : {}),
    fromIndex: true,
    ...(r.noindex ? { noindex: true } : {}),
    ...(r.reviewers?.length ? { reviewers: r.reviewers.filter((x) => typeof x?.did === 'string').slice(0, 20).map((x) => ({ did: x.did!, ...(typeof x.handle === 'string' ? { handle: x.handle } : {}) })) } : {}),
    ...(r.kind === 'video' || videos.length
      ? {
          kind: 'video' as const,
          videos,
          videoDescription: videos[0]?.description,
          ...(preview && preview.end > preview.start ? { videoPreviewRange: preview } : {}),
        }
      : {}),
    likeCount: i.likeCount ?? 0,
    commentCount: i.commentCount ?? 0,
    ...(r.text ? {} : { bodyPending: true }),
    cid: i.cid,
    indexedAt: created,
    sourceType: crawled ? 'crawler' : 'native-pds',
    canonicalId: i.uri,
    ...(crawled ? { source: { url: r.source!.url!, label: r.source!.site ?? new URL(r.source!.url!).hostname } } : {}),
    ...(r.paywall?.price !== undefined
      ? {
          paywall: {
            price: r.paywall.price / 100,
            currency: r.paywall.currency ?? 'RUB',
            period: r.paywall.accessType === 'subscription' ? 'month' : 'once',
            accessType: r.paywall.accessType ?? 'one-time',
            tierId: r.paywall.tierId,
            privateContentId: r.privateContent?.id,
          },
        }
      : {}),
  }
}

/** комментарий треда → комментарий страницы статьи: id — AT URI, ответы ссылаются на uri родителя */
export function toComment(c: ThreadComment): Comment {
  return {
    id: c.uri,
    author: c.handle ?? c.did,
    text: c.text,
    at: c.createdAt.slice(0, 16).replace('T', ' '),
    ...(c.parent ? { parentId: c.parent } : {}),
    ...(c.pendingUntil ? { pendingUntil: c.pendingUntil } : {}),
  }
}

/** тред статьи из индекса; недоступен — пусто (страница покажет локальные) */
export function fetchComments(subject: string): Promise<Comment[]> {
  return comments.thread(subject).then((r) => r.comments.map(toComment), () => [])
}

/** текст одной статьи — для страницы статьи (лента приходит без текстов) */
const bodies = new Map<string, Promise<Article | null>>()

/** один запрос на статью: предзагрузка при наведении и открытие страницы делят его */
export function fetchArticleBody(uri: string): Promise<Article | null> {
  let p = bodies.get(uri)
  if (!p) {
    p = fetch(`${BASE}/feed/article?${new URLSearchParams({ uri })}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((j) => (j ? toArticle(j as FeedItem) : null))
      .catch(() => null)
    bodies.set(uri, p)
    // кэш небольшой: старые записи вытесняются
    if (bodies.size > 50) bodies.delete(bodies.keys().next().value!)
  }
  return p
}

export interface RankQuery {
  sort: 'hot' | 'best'
  metric?: 'likes' | 'comments'
  period?: 'day' | 'week' | 'month' | 'all'
  source?: 'internal' | 'external'
  /** любой из тегов */
  tags?: string[]
  lang?: string
  kind?: 'video' | 'text'
  limit?: number
}

/** ранжирование индекса (services/feed/src/rank.rs); ошибка или пустой индекс — [] */
export async function fetchRanked(q: RankQuery): Promise<{ article: Article; score: number }[]> {
  const params = new URLSearchParams({ limit: String(q.limit ?? 50), sort: q.sort })
  for (const k of ['metric', 'period', 'source', 'lang', 'kind'] as const) if (q[k]) params.set(k, q[k]!)
  if (q.tags?.length) params.set('tags', q.tags.join(','))
  try {
    const res = await fetch(`${BASE}/feed?${params}`)
    if (!res.ok) return []
    const page = (await res.json()) as { articles: FeedItem[] }
    return page.articles.flatMap((i) => {
      const article = toArticle(i)
      return article ? [{ article, score: i.score ?? 0 }] : []
    })
  } catch {
    return []
  }
}

/** «Читать дальше» к статье из индекса; пусто — индекс не нашёл похожих или недоступен */
export async function fetchRelated(uri: string, limit = 3, kind?: 'video' | 'text'): Promise<Article[]> {
  try {
    const res = await fetch(`${BASE}/feed/related?${new URLSearchParams({ uri, limit: String(limit), ...(kind ? { kind } : {}) })}`)
    if (!res.ok) return []
    const page = (await res.json()) as { articles: FeedItem[] }
    return page.articles.map(toArticle).filter((a): a is Article => a !== null)
  } catch {
    return []
  }
}

/** до pages страниц по 100: лента и «Лучшее» считаются по последним записям */
export async function fetchRemoteFeed(pages = 3): Promise<Article[]> {
  const out: FeedItem[] = []
  let cursor: string | null | undefined
  for (let i = 0; i < pages; i++) {
    const res = await fetch(`${BASE}/feed?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`)
    if (!res.ok) break
    const page = (await res.json()) as { articles: FeedItem[]; cursor?: string | null }
    out.push(...page.articles)
    cursor = page.cursor
    if (!cursor) break
  }
  return out.map(toArticle).filter((a): a is Article => a !== null)
}
