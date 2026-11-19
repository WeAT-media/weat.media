import { renderToString } from 'react-dom/server'
import { StaticRouter } from 'react-router'
import App, { type AppPages } from './App'
import LandingPage from './pages/LandingPage'
import Feed from './pages/Feed'
import HotPage from './pages/HotPage'
import ArticlePage from './pages/ArticlePage'
import ProfilePage from './pages/ProfilePage'
import { toArticle, type FeedItem } from './lib/remoteFeed'
import type { SsrData } from './lib/ssr'
import type { ApiUser } from './lib/api'

const pages: AppPages = { Landing: LandingPage, Feed, Hot: HotPage, Article: ArticlePage, Profile: ProfilePage }

async function json<T>(url: string): Promise<T | null> {
  const res = await fetch(url, { signal: AbortSignal.timeout(5000) }).catch(() => null)
  return res?.ok ? await res.json() as T : null
}

function articlesOf(page: { articles?: FeedItem[] } | null) {
  return (page?.articles ?? []).map(toArticle).filter((a) => a !== null)
}

export async function render(url: string, apiBase: string): Promise<{ html: string; data: SsrData }> {
  const u = new URL(url, 'https://weat.media')
  const data: SsrData = { path: u.pathname }
  const articleId = /^\/article\/([^/]+)$/.exec(u.pathname)?.[1]
  const profileId = /^\/profile\/([^/]+)$/.exec(u.pathname)?.[1]

  if (u.pathname === '/feed') {
    const page = Math.max(1, Number(u.searchParams.get('page')) || 1)
    const tags = u.searchParams.get('tags')?.split(',').filter(Boolean) ?? []
    const lang = u.searchParams.get('lang') ?? 'all'
    const kindParam = u.searchParams.get('kind')
    const kind = kindParam === 'video' || kindParam === 'text' ? kindParam : 'all'
    const q = new URLSearchParams({ limit: '10', offset: String((page - 1) * 10) })
    if (tags.length) q.set('tags', tags.join(','))
    if (lang !== 'all') q.set('lang', lang)
    if (kind !== 'all') q.set('kind', kind)
    const result = await json<{ articles?: FeedItem[]; total?: number }>(`${apiBase}/feed?${q}`)
    data.articles = articlesOf(result)
    data.feed = { key: `${tags.join(',')}|${lang}|${kind}|${page}`, articles: data.articles, total: result?.total ?? data.articles.length }
  } else if (u.pathname === '/hot') {
    const result = await json<{ articles?: FeedItem[] }>(`${apiBase}/feed?sort=hot&period=week&limit=50`)
    data.articles = articlesOf(result)
    data.hot = {
      period: 'week',
      list: (result?.articles ?? []).flatMap((item) => {
        const a = toArticle(item)
        return a ? [{ a, score: item.score ?? 0 }] : []
      }),
    }
  } else if (articleId) {
    const item = await json<FeedItem>(`${apiBase}/feed/article?${new URLSearchParams({ short: articleId })}`)
    const article = item ? toArticle(item) : null
    data.articles = article ? [article] : []
  } else if (profileId) {
    const id = decodeURIComponent(profileId)
    const [profile, result] = await Promise.all([
      json<ApiUser>(`${apiBase}/users/${encodeURIComponent(id)}`),
      json<{ articles?: FeedItem[] }>(`${apiBase}/feed?${new URLSearchParams({ author: id, limit: '100' })}`),
    ])
    data.profile = profile ?? undefined
    data.articles = articlesOf(result)
  }

  ;(globalThis as typeof globalThis & { __WEAT_SSR__?: SsrData }).__WEAT_SSR__ = data
  const html = renderToString(
    <StaticRouter location={url}>
      <App pages={pages} />
    </StaticRouter>,
  )
  delete (globalThis as typeof globalThis & { __WEAT_SSR__?: SsrData }).__WEAT_SSR__
  return { html, data }
}
