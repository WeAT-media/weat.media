import type { Hono } from 'hono'

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

export function mountShareRoutes(app: Hono, d: { feedUrl?: string; siteUrl: string; siteName?: string; restricted?: { enabled: boolean; blocked(uris: string[]): Promise<Set<string>> } }) {
  const siteName = d.siteName ?? 'weAT.media'
  const image = `${d.siteUrl}/og-image.png`

  app.get('/share/article/:id', async (c) => {
    const id = c.req.param('id')
    const url = `${d.siteUrl}/article/${encodeURIComponent(id)}`
    const fallback = () => c.html(sharePage({ siteName, siteUrl: d.siteUrl, url, title: siteName, description: 'Медиа на открытом протоколе AT: ваш аккаунт и тексты принадлежат вам.', image }))
    if (!SHORT_ID.test(id) || !d.feedUrl) return fallback()
    const res = await fetch(`${d.feedUrl}/feed-api/article?${new URLSearchParams({ short: id })}`, { signal: AbortSignal.timeout(3000) }).catch(() => null)
    if (!res?.ok) return fallback()
    const a = (await res.json()) as { uri?: string; handle?: string | null; created_at?: string; record?: { title?: string; subtitle?: string; excerpt?: string; text?: string; noindex?: boolean } }
    // РФ-контур: закрытая запись — без заголовка и текста, общая карточка
    if (a.uri && d.restricted?.enabled && (await d.restricted.blocked([a.uri])).has(a.uri)) return fallback()
    const r = a.record ?? {}
    const title = (r.title ?? '').trim() || siteName
    const description = (r.subtitle ?? '').trim() || (r.excerpt ?? '').trim() || plainExcerpt(r.text ?? '') || siteName
    c.header('cache-control', 'public, max-age=300')
    return c.html(sharePage({ siteName, siteUrl: d.siteUrl, url, title: title.slice(0, 200), description: description.slice(0, 300), author: a.handle ? `@${a.handle}` : undefined, image, publishedAt: a.created_at, noindex: r.noindex === true }))
  })
}
