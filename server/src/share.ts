import type { Hono } from 'hono'
import { resolvePds } from './imports.js'
import { avatarDataUri, renderArticleCard } from './ogImage.js'
import type { PendingSource } from './cooldown.js'
import { ARTICLE_COLLECTION } from './paidContent.js'
import { createSafeFetch, readBodyLimited, type SafeFetch } from './safeFetch.js'

/**
 * Читаемый HTML, Open Graph / Twitter Card и BlogPosting для поисковых, AI- и соцсетевых ботов:
 * Caddy отдаёт им /article/<id> отсюда, а людям — обычный SPA (deploy/node/Caddyfile, @share_bot).
 * Здесь только публичное. Платный текст сюда не попадает — в индексе ленты у платной статьи только тизер.
 */

const SHORT_ID = /^[A-Za-z0-9._~:]{1,60}-[A-Za-z0-9]{6}$/

const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!)

/** первые ~200 символов текста без markdown-разметки */
export function plainExcerpt(md: string, max = 200): string {
  const t = md
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^#+\s+/gm, '')
    .replace(/[*_`>~|]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t
}

function markdownHtml(markdown: string): string {
  const blocks = markdown.replace(/\r/g, '').split(/\n{2,}/)
  return blocks.map((raw) => {
    const block = raw.trim()
    if (!block) return ''
    const heading = /^(#{1,3})\s+(.+)$/.exec(block)
    if (heading) {
      const level = Math.min(4, heading[1]!.length + 1)
      return `<h${level}>${inlineMarkdown(heading[2]!)}</h${level}>`
    }
    const lines = block.split('\n').filter(Boolean)
    if (lines.every((line) => /^[-*]\s+/.test(line))) return `<ul>${lines.map((line) => `<li>${inlineMarkdown(line.replace(/^[-*]\s+/, ''))}</li>`).join('')}</ul>`
    if (lines.every((line) => /^\d+\.\s+/.test(line))) return `<ol>${lines.map((line) => `<li>${inlineMarkdown(line.replace(/^\d+\.\s+/, ''))}</li>`).join('')}</ol>`
    return `<p>${lines.map(inlineMarkdown).join('<br>')}</p>`
  }).join('\n')
}

function inlineMarkdown(text: string): string {
  return esc(text)
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
}

export function sharePage(o: { siteName: string; siteUrl: string; url: string; title: string; description: string; author?: string; authorUrl?: string; image: string; publishedAt?: string; modifiedAt?: string; text?: string; tags?: string[]; noindex?: boolean }): string {
  const title = esc(o.title)
  const desc = esc(o.description)
  const ld = JSON.stringify(o.text ? {
    '@context': 'https://schema.org', '@type': 'BlogPosting', mainEntityOfPage: o.url, headline: o.title, description: o.description,
    image: [o.image], datePublished: o.publishedAt, dateModified: o.modifiedAt ?? o.publishedAt, inLanguage: 'ru',
    author: { '@type': 'Person', name: o.author ?? o.siteName, ...(o.authorUrl ? { url: o.authorUrl } : {}) },
    publisher: { '@type': 'Organization', name: o.siteName, url: o.siteUrl }, keywords: o.tags?.join(', '),
  } : {
    '@context': 'https://schema.org', '@type': 'WebSite', name: o.siteName, url: o.siteUrl, description: o.description,
  }).replace(/</g, '\\u003c')
  return `<!doctype html>
<html lang="ru"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} — ${esc(o.siteName)}</title>
<meta name="description" content="${desc}">
${o.noindex ? '<meta name="robots" content="noindex">\n' : ''}
<link rel="canonical" href="${esc(o.url)}">
<meta property="og:type" content="${o.text ? 'article' : 'website'}">
<meta property="og:site_name" content="${esc(o.siteName)}">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${desc}">
<meta property="og:url" content="${esc(o.url)}">
<meta property="og:image" content="${esc(o.image)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:locale" content="ru_RU">
${o.publishedAt ? `<meta property="article:published_time" content="${esc(o.publishedAt)}">\n` : ''}${o.author ? `<meta property="article:author" content="${esc(o.author)}">\n<meta name="author" content="${esc(o.author)}">\n` : ''}<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${title}">
<meta name="twitter:description" content="${desc}">
<meta name="twitter:image" content="${esc(o.image)}">
<script type="application/ld+json">${ld}</script>
</head><body>
<main><article>
<h1>${title}</h1>
${o.author ? `<p>Автор: ${o.authorUrl ? `<a href="${esc(o.authorUrl)}">${esc(o.author)}</a>` : esc(o.author)}</p>` : ''}
${o.publishedAt ? `<p><time datetime="${esc(o.publishedAt)}">${esc(o.publishedAt.slice(0, 10))}</time></p>` : ''}
<p><strong>${desc}</strong></p>
${o.text ? markdownHtml(o.text) : ''}
</article></main>
</body></html>`
}

export function sitemapXml(entries: { loc: string; lastmod?: string }[]): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries.map((e) => `  <url><loc>${esc(e.loc)}</loc>${e.lastmod ? `<lastmod>${esc(e.lastmod)}</lastmod>` : ''}</url>`).join('\n')}\n</urlset>\n`
}

interface FeedArticle {
  uri?: string
  did?: string
  handle?: string | null
  created_at?: string
  record?: { title?: string; subtitle?: string; excerpt?: string; text?: string; noindex?: boolean; createdAt?: string; updatedAt?: string; tags?: string[]; source?: { site?: string; author?: string } }
}

/** имя и фото автора из его профиля AT (app.bsky.actor.profile на его PDS) */
async function authorProfile(did: string, plcUrl: string, fetcher: SafeFetch): Promise<{ name: string | null; avatar: string | null }> {
  const pds = await resolvePds(did, plcUrl, fetcher).catch(() => null)
  if (!pds) return { name: null, avatar: null }
  const res = await fetcher(`${pds}/xrpc/com.atproto.repo.getRecord?${new URLSearchParams({ repo: did, collection: 'app.bsky.actor.profile', rkey: 'self' })}`, { signal: AbortSignal.timeout(3000) }).catch(() => null)
  const v = res?.ok
    ? await readBodyLimited(res, 1024 * 1024)
        .then((buf) => (JSON.parse(buf.toString('utf8')) as { value?: { displayName?: string; avatar?: { ref?: { $link?: string } } } }).value)
        .catch(() => undefined)
    : undefined
  const cid = v?.avatar?.ref?.$link
  const avatar = cid ? await avatarDataUri(`${pds}/xrpc/com.atproto.sync.getBlob?${new URLSearchParams({ did, cid })}`, fetcher) : null
  return { name: v?.displayName?.trim() || null, avatar }
}

export function mountShareRoutes(app: Hono, d: { feedUrl?: string; siteUrl: string; siteName?: string; plcUrl?: string; allowPrivate?: boolean; pending?: PendingSource; restricted?: { enabled: boolean; blocked(uris: string[]): Promise<Set<string>> }; moved?: (uris: string[]) => Promise<Map<string, string>> }) {
  const siteName = d.siteName ?? 'weAT.media'
  const image = `${d.siteUrl}/og-image.png`
  const plcUrl = d.plcUrl ?? 'https://plc.directory'
  const fetcher = createSafeFetch({ allowPrivate: d.allowPrivate })

  /** публичная статья из индекса ленты; null — нет, недоступна или закрыта в этом контуре */
  const article = async (id: string): Promise<FeedArticle | null> => {
    if (!SHORT_ID.test(id)) return null
    const res = d.feedUrl ? await fetch(`${d.feedUrl}/feed-api/article?${new URLSearchParams({ short: id })}`, { signal: AbortSignal.timeout(3000) }).catch(() => null) : null
    let a = res?.ok ? ((await res.json()) as FeedArticle) : null
    // статья в периоде охлаждения ещё не в индексе ленты — ищем среди ждущих (своих и соседнего контура)
    if (!a && d.pending) {
      const [rkey, tail] = [id.slice(0, id.lastIndexOf('-')), id.slice(id.lastIndexOf('-') + 1)]
      const p = (await d.pending.list(ARTICLE_COLLECTION)).find((x) => x.uri.endsWith(`/${rkey}`) && x.did.endsWith(tail))
      if (p) a = { uri: p.uri, did: p.did, handle: p.handle, created_at: p.createdAt, record: p.record as FeedArticle['record'] }
    }
    if (!a) return null
    // РФ-контур: закрытая запись — без заголовка и текста, общая карточка
    if (a.uri && d.restricted?.enabled && (await d.restricted.blocked([a.uri])).has(a.uri)) return null
    return a
  }

  // файлы автора (фото профиля и др.) — с PDS самого автора по его DID-документу: в общей ленте автор
  // может быть из другого контура или вообще со своего PDS. Браузер идёт туда напрямую (302).
  const pdsOf = new Map<string, { at: number; pds: string }>()
  app.get('/blob/:did/:cid', async (c) => {
    const { did, cid } = c.req.param()
    if (!/^did:(plc:[a-z2-7]{24}|web:[a-zA-Z0-9.%-]{1,253})$/.test(did) || !/^[a-z0-9]{20,120}$/.test(cid)) return c.json({ error: 'InvalidRequest', message: 'Неверный DID или CID' }, 400)
    let hit = pdsOf.get(did)
    if (!hit || Date.now() - hit.at > 3_600_000) {
      const pds = await resolvePds(did, plcUrl, fetcher).catch(() => null)
      if (!pds) return c.json({ error: 'NotFound', message: 'Сервер автора не найден' }, 404)
      if (pdsOf.size > 5000) pdsOf.delete(pdsOf.keys().next().value!)
      pdsOf.set(did, (hit = { at: Date.now(), pds }))
    }
    c.header('cache-control', 'public, max-age=3600')
    return c.redirect(`${hit.pds}/xrpc/com.atproto.sync.getBlob?${new URLSearchParams({ did, cid })}`, 302)
  })

  // профиль (имя, «О себе») из записи app.bsky.actor.profile — с PDS самого автора: настройки профиля
  // открываются и тогда, когда аккаунт из соседнего контура
  app.get('/profile-record/:did', async (c) => {
    const did = c.req.param('did')
    if (!/^did:(plc:[a-z2-7]{24}|web:[a-zA-Z0-9.%-]{1,253})$/.test(did)) return c.json({ error: 'InvalidRequest', message: 'Неверный DID' }, 400)
    const pds = await resolvePds(did, plcUrl).catch(() => null)
    if (!pds) return c.json({ displayName: null, description: null })
    const res = await fetch(`${pds}/xrpc/com.atproto.repo.getRecord?${new URLSearchParams({ repo: did, collection: 'app.bsky.actor.profile', rkey: 'self' })}`, { signal: AbortSignal.timeout(4000) }).catch(() => null)
    const v = res?.ok ? ((await res.json()) as { value?: { displayName?: string; description?: string } }).value : undefined
    c.header('cache-control', 'no-store')
    return c.json({ displayName: v?.displayName ?? null, description: v?.description ?? null })
  })

  // картинка превью статьи: название и автор; готовые PNG — в памяти на час
  const cards = new Map<string, { at: number; png: Buffer }>()
  app.get('/og/article/:file', async (c) => {
    const id = c.req.param('file').replace(/\.png$/, '')
    const hit = cards.get(id)
    if (hit && Date.now() - hit.at < 3_600_000) return c.body(new Uint8Array(hit.png), 200, { 'content-type': 'image/png', 'cache-control': 'public, max-age=3600' })
    const a = await article(id)
    const r = a?.record
    if (!a || !r?.title?.trim()) return c.redirect(image, 302)
    const did = a.did ?? a.uri?.split('/')[2]
    const crawled = r.source?.author?.trim()
    const p = !crawled && did ? await authorProfile(did, plcUrl, fetcher) : { name: null, avatar: null }
    const png = await renderArticleCard({
      title: r.title,
      author: crawled || p.name || a.handle || siteName,
      handle: crawled ? null : (a.handle ?? null),
      site: crawled ? (r.source?.site ?? null) : null,
      tags: Array.isArray((r as { tags?: unknown }).tags) ? ((r as { tags: unknown[] }).tags.filter((t): t is string => typeof t === 'string')) : [],
      avatar: p.avatar,
      siteName,
    }).catch(() => null)
    if (!png) return c.redirect(image, 302)
    if (cards.size > 500) cards.delete(cards.keys().next().value!)
    cards.set(id, { at: Date.now(), png })
    return c.body(new Uint8Array(png), 200, { 'content-type': 'image/png', 'cache-control': 'public, max-age=3600' })
  })

  app.get('/sitemap.xml', async (c) => {
    if (!d.feedUrl) return c.text('sitemap unavailable', 503)
    const entries = ['/', '/feed', '/hot', '/collections', '/cases', '/atmosphere', '/premium', '/docs', '/support', '/legal']
      .map((path) => ({ loc: `${d.siteUrl}${path}` }))
    const authors = new Set<string>()
    let cursor = ''
    for (let page = 0; page < 50; page++) {
      const q = new URLSearchParams({ limit: '100', sort: 'new', ...(cursor ? { cursor } : {}) })
      const res = await fetch(`${d.feedUrl}/feed-api/articles?${q}`, { signal: AbortSignal.timeout(5000) }).catch(() => null)
      if (!res?.ok) return c.text('sitemap unavailable', 503)
      const body = await res.json() as { articles?: FeedArticle[]; cursor?: string }
      const articles = body.articles ?? []
      const uris = articles.flatMap((a) => a.uri ? [a.uri] : [])
      const [blocked, moved] = await Promise.all([
        d.restricted?.enabled ? d.restricted.blocked(uris) : Promise.resolve(new Set<string>()),
        d.moved ? d.moved(uris).catch(() => new Map<string, string>()) : Promise.resolve(new Map<string, string>()),
      ])
      for (const a of articles) {
        if (!a.uri || a.record?.noindex || blocked.has(a.uri) || moved.has(a.uri)) continue
        const [, , did = '', , rkey = ''] = a.uri.split('/')
        if (!did || !rkey) continue
        const date = a.record?.updatedAt ?? a.record?.createdAt ?? a.created_at
        entries.push({ loc: `${d.siteUrl}/article/${encodeURIComponent(`${rkey}-${did.slice(-6)}`)}`, ...(date ? { lastmod: date.slice(0, 10) } : {}) })
        if (a.handle) authors.add(a.handle)
      }
      if (!body.cursor || articles.length === 0) break
      cursor = body.cursor
    }
    for (const handle of authors) entries.push({ loc: `${d.siteUrl}/profile/${encodeURIComponent(handle)}` })
    c.header('cache-control', 'public, max-age=300')
    return c.body(sitemapXml(entries), 200, { 'content-type': 'application/xml; charset=utf-8' })
  })

  app.get('/share/article/:id', async (c) => {
    const id = c.req.param('id')
    const url = `${d.siteUrl}/article/${encodeURIComponent(id)}`
    const a = await article(id)
    if (!a) return c.html(sharePage({ siteName, siteUrl: d.siteUrl, url, title: 'Статья не найдена', description: 'Запрошенная публикация не найдена.', image, noindex: true }), 404)
    const r = a.record ?? {}
    const title = (r.title ?? '').trim() || siteName
    const description = (r.subtitle ?? '').trim() || (r.excerpt ?? '').trim() || plainExcerpt(r.text ?? '') || siteName
    const author = a.handle ? `@${a.handle}` : r.source?.author
    c.header('cache-control', 'public, max-age=300')
    return c.html(sharePage({ siteName, siteUrl: d.siteUrl, url, title: title.slice(0, 200), description: description.slice(0, 300), author, authorUrl: a.handle ? `${d.siteUrl}/profile/${encodeURIComponent(a.handle)}` : undefined, image: r.title?.trim() ? `${d.siteUrl}/api/og/article/${encodeURIComponent(id)}.png` : image, publishedAt: r.createdAt ?? a.created_at, modifiedAt: r.updatedAt ?? a.created_at, text: r.text, tags: r.tags, noindex: r.noindex === true }))
  })
}
