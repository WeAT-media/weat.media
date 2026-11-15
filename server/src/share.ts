import type { Hono } from 'hono'
import { resolvePds } from './imports.js'
import { avatarDataUri, renderArticleCard } from './ogImage.js'
import { createSafeFetch, readBodyLimited, type SafeFetch } from './safeFetch.js'

/**
 * Превью ссылок (Open Graph / Twitter Card) для ботов соцсетей и мессенджеров: они не выполняют JS,
 * поэтому Caddy отдаёт им /article/<id> отсюда, а людям — обычный SPA (deploy/node/Caddyfile, @share_bot).
 * Здесь только публичное: заголовок, подзаголовок/начало текста, автор. Платный текст сюда не попадает —
 * в индексе ленты у платной статьи только тизер.
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

export function sharePage(o: { siteName: string; siteUrl: string; url: string; title: string; description: string; author?: string; image: string; publishedAt?: string; noindex?: boolean }): string {
  const title = esc(o.title)
  const desc = esc(o.description)
  return `<!doctype html>
<html lang="ru"><head>
<meta charset="utf-8">
<title>${title} — ${esc(o.siteName)}</title>
<meta name="description" content="${desc}">
${o.noindex ? '<meta name="robots" content="noindex">\n' : ''}
<link rel="canonical" href="${esc(o.url)}">
<meta property="og:type" content="article">
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
</head><body>
<h1>${title}</h1>
<p>${desc}</p>
<p><a href="${esc(o.url)}">Читать на ${esc(o.siteName)}</a></p>
</body></html>`
}

interface FeedArticle {
  uri?: string
  did?: string
  handle?: string | null
  created_at?: string
  record?: { title?: string; subtitle?: string; excerpt?: string; text?: string; noindex?: boolean; source?: { site?: string; author?: string } }
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

export function mountShareRoutes(app: Hono, d: { feedUrl?: string; siteUrl: string; siteName?: string; plcUrl?: string; allowPrivate?: boolean; restricted?: { enabled: boolean; blocked(uris: string[]): Promise<Set<string>> } }) {
  const siteName = d.siteName ?? 'weAT.media'
  const image = `${d.siteUrl}/og-image.png`
  const plcUrl = d.plcUrl ?? 'https://plc.directory'
  const fetcher = createSafeFetch({ allowPrivate: d.allowPrivate })

  /** публичная статья из индекса ленты; null — нет, недоступна или закрыта в этом контуре */
  const article = async (id: string): Promise<FeedArticle | null> => {
    if (!SHORT_ID.test(id) || !d.feedUrl) return null
    const res = await fetch(`${d.feedUrl}/feed-api/article?${new URLSearchParams({ short: id })}`, { signal: AbortSignal.timeout(3000) }).catch(() => null)
    if (!res?.ok) return null
    const a = (await res.json()) as FeedArticle
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
      handle: crawled ? (r.source?.site ?? null) : (a.handle ?? null),
      avatar: p.avatar,
      siteName,
    }).catch(() => null)
    if (!png) return c.redirect(image, 302)
    if (cards.size > 500) cards.delete(cards.keys().next().value!)
    cards.set(id, { at: Date.now(), png })
    return c.body(new Uint8Array(png), 200, { 'content-type': 'image/png', 'cache-control': 'public, max-age=3600' })
  })

  app.get('/share/article/:id', async (c) => {
    const id = c.req.param('id')
    const url = `${d.siteUrl}/article/${encodeURIComponent(id)}`
    const fallback = () => c.html(sharePage({ siteName, siteUrl: d.siteUrl, url, title: siteName, description: 'Медиа на открытом протоколе AT: ваш аккаунт и тексты принадлежат вам.', image }))
    const a = await article(id)
    if (!a) return fallback()
    const r = a.record ?? {}
    const title = (r.title ?? '').trim() || siteName
    const description = (r.subtitle ?? '').trim() || (r.excerpt ?? '').trim() || plainExcerpt(r.text ?? '') || siteName
    c.header('cache-control', 'public, max-age=300')
    return c.html(sharePage({ siteName, siteUrl: d.siteUrl, url, title: title.slice(0, 200), description: description.slice(0, 300), author: a.handle ? `@${a.handle}` : undefined, image: r.title?.trim() ? `${d.siteUrl}/api/og/article/${encodeURIComponent(id)}.png` : image, publishedAt: a.created_at, noindex: r.noindex === true }))
  })
}
