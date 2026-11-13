import type { Article, ArticleBlock } from '@/types/types'

/** Записи media.weat.article из /api/feed → статьи ленты */

interface FeedItem {
  uri: string
  cid: string
  did: string
  handle: string
  /** длина текста: лента отдаёт карточки без самого текста */
  textLength?: number
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
  }
}

// import.meta.env?. — модуль используется и вне Vite (проверки разбора)
const BASE = import.meta.env?.VITE_API_URL ?? '/api'

/** markdown → блоки статьи: заголовки, код, цитаты, списки, абзацы */
export function markdownToBlocks(md: string): ArticleBlock[] {
  const blocks: ArticleBlock[] = []
  const lines = md.replace(/\r\n/g, '\n').split('\n')
  let para: string[] = []
  // картинка: ![подпись](адрес) или картинка-ссылка [![подпись](адрес)](куда)
  const IMG = /\[?!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)(?:\]\([^)]+\))?/g
  const flush = () => {
    const t = para.join(' ').trim()
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
      blocks.push({ type: 'code', text: code.join('\n'), ...(fence[1] ? { lang: fence[1] } : {}) })
    } else if (/^#{1,6}\s/.test(line)) {
      flush()
      blocks.push({ type: 'h2', text: line.replace(/^#{1,6}\s+/, '') })
    } else if (line.startsWith('>')) {
      flush()
      blocks.push({ type: 'quote', text: line.replace(/^>\s?/, '') })
    } else if (/^\s*[-*]\s+/.test(line)) {
      flush()
      const items = [line.replace(/^\s*[-*]\s+/, '')]
      while (i + 1 < lines.length && /^\s*[-*]\s+/.test(lines[i + 1]!)) items.push(lines[++i]!.replace(/^\s*[-*]\s+/, ''))
      blocks.push({ type: 'ul', text: items.join('\n') })
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

export function toArticle(i: FeedItem): Article | null {
  const r = i.record
  if (!r.title) return null
  const blocks = r.text ? markdownToBlocks(r.text) : []
  // ≈ 6 символов на слово, 200 слов в минуту
  const words = r.text ? r.text.split(/\s+/).length : Math.round((i.textLength ?? 0) / 6)
  const created = r.createdAt ?? new Date().toISOString()
  const crawled = !!r.source?.url
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
    excerpt: r.excerpt ?? blocks.find((b) => b.type === 'p')?.text.slice(0, 300) ?? '',
    blocks,
    comments: [],
    atUri: i.uri,
    fromIndex: true,
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
