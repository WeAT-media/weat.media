import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const templatePath = process.env.SSR_TEMPLATE || '/srv/app.html'
const template = await readFile(templatePath, 'utf8')
const manifest = JSON.parse(await readFile(process.env.SSR_MANIFEST || '/srv/.vite/manifest.json', 'utf8'))
const cssFile = manifest['index.html']?.css?.[0]
const inlineCss = cssFile ? await readFile(resolve(templatePath, '..', cssFile), 'utf8') : ''
const { render } = await import(pathToFileURL(resolve(process.env.SSR_BUNDLE || '/srv-ssr/entry-server.js')).href)
const apiBase = (process.env.SSR_API_BASE || 'http://appview:8787/api').replace(/\/$/, '')
const mainSrc = /<script type="module" crossorigin src="([^"]+)"/.exec(template)?.[1] || '/assets/'
const cache = new Map()

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
const safeJson = (value) => JSON.stringify(value).replace(/</g, '\\u003c')

// Чанки статических страниц (src/lib/staticPages.ts) — чтобы гидрация не ждала цепочку import().
const staticSources = [
  [/^\/atmosphere$/, 'src/pages/AtmospherePage.tsx'],
  [/^\/premium$/, 'src/pages/PremiumPage.tsx'],
  [/^\/collections$/, 'src/pages/CollectionsPages.tsx'],
  [/^\/cases$/, 'src/pages/CasesPage.tsx'],
  [/^\/api$/, 'src/pages/ApiDocsPage.tsx'],
  [/^\/docs$/, 'src/pages/DocsPage.tsx'],
  [/^\/ads$/, 'src/pages/AdsPage.tsx'],
  [/^\/crawler$/, 'src/pages/CrawlerInfoPage.tsx'],
  [/^\/support$/, 'src/pages/SupportPage.tsx'],
  [/^\/support\/contact$/, 'src/pages/SupportContactPage.tsx'],
  [/^\/support\/legal$/, 'src/pages/SupportLegalPage.tsx'],
  [/^\/legal(\/[^/]+)?$/, 'src/pages/legal/LegalPages.tsx'],
  [/^\/login$/, 'src/pages/LoginPage.tsx'],
]

function preload(path) {
  const key = path === '/feed' ? 'src/pages/Feed.tsx'
    : path === '/hot' ? 'src/pages/HotPage.tsx'
      : path.startsWith('/article/') ? 'src/pages/ArticlePage.tsx'
        : path.startsWith('/profile/') ? 'src/pages/ProfilePage.tsx'
          : staticSources.find(([re]) => re.test(path))?.[1] ?? null
  if (!key || !manifest[key]) return ''
  const seen = new Set()
  const files = []
  const add = (id) => {
    const item = manifest[id]
    if (!item || seen.has(id)) return
    seen.add(id)
    if (item.file) files.push(item.file)
    for (const dep of item.imports || []) add(dep)
  }
  add(key)
  const entryDir = manifest['src/main.tsx']?.file.replace(/[^/]+$/, '') || 'assets/'
  const base = new URL(mainSrc, 'https://weat.media')
  return files.map((file) => {
    const url = new URL(file.startsWith(entryDir) ? file.slice(entryDir.length) : file, base)
    const href = mainSrc.startsWith('/') ? url.pathname : url.href
    return `<link rel="modulepreload" crossorigin href="${href}">`
  }).join('')
}

async function page(url) {
  const { html, data } = await render(url, apiBase)
  const article = data.articles?.[0]
  const title = data.path.startsWith('/article/') && article ? `${article.title} — weAT.media`
    : data.path.startsWith('/profile/') && data.profile ? `${data.profile.displayName || data.profile.handle} — weAT.media`
      : data.path === '/feed' ? 'Лента — weAT.media'
        : data.path === '/hot' ? 'Горячее — weAT.media' : null
  let output = template.replace('<div id="root"></div>', `<div id="root">${html}</div>`)
  if (title) output = output.replace(/<title>[^<]*<\/title>/, `<title>${escapeHtml(title)}</title>`)
  const pageUrl = `https://weat.media${data.path}`
  const canonical = data.path.startsWith('/article/') ? article?.republished?.url || pageUrl : pageUrl
  if (article && data.path.startsWith('/article/')) {
    if (inlineCss) output = output.replace(/<link rel="stylesheet"[^>]*>/, `<style>${inlineCss}</style>`)
    const description = (article.subtitle || article.excerpt || '').slice(0, 300)
    const image = `https://weat.media/api/og/article/${encodeURIComponent(article.id)}.png`
    const meta = (attribute, key, value) => {
      output = output.replace(new RegExp(`<meta ${attribute}="${key}" content="[^"]*" />`), `<meta ${attribute}="${key}" content="${escapeHtml(value)}" />`)
    }
    meta('property', 'og:type', 'article')
    meta('property', 'og:title', article.title)
    meta('property', 'og:description', description)
    meta('property', 'og:url', pageUrl)
    meta('property', 'og:image', image)
    meta('property', 'og:image:alt', article.title)
    meta('property', 'vk:image', image)
    meta('name', 'twitter:title', article.title)
    meta('name', 'twitter:description', description)
    meta('name', 'twitter:image', image)
    meta('name', 'twitter:image:alt', article.title)
    output = output.replace(/<meta name="description" content="[^"]*" \/>/, `<meta name="description" content="${escapeHtml(description)}" />`)
    // standard.site: обратная ссылка на копию в site.standard.document — её делает сервер у бесплатных статей
    // (server/src/standardDoc.ts); по ней клиенты standard.site проверяют, что документ принадлежит странице
    const m = /^at:\/\/(did:[a-z]+:[A-Za-z0-9._:%-]+)\/media\.weat\.article\/([A-Za-z0-9._~:-]+)$/.exec(article.atUri || '')
    if (m && !article.paywall && !article.noindex && article.sourceType === 'native-pds') {
      output = output.replace('</head>', `<link rel="site.standard.document" href="${escapeHtml(`at://${m[1]}/site.standard.document/${m[2]}`)}" /></head>`)
    }
  } else if (title) {
    output = output.replace(/<meta property="og:title" content="[^"]*" \/>/, `<meta property="og:title" content="${escapeHtml(title)}" />`)
  }
  output = output.replace(/<link rel="canonical" href="[^"]*" \/>/, `<link rel="canonical" href="${escapeHtml(canonical)}" />`)
  output = output.replace('</head>', `${preload(data.path)}</head>`)
  return output.replace('</body>', `<script type="application/json" id="weat-ssr-data">${safeJson(data)}</script></body>`)
}

createServer(async (req, res) => {
  if (req.url === '/ssr-health') {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end('{"ok":true}')
    return
  }
  try {
    const key = req.url || '/'
    let pending = cache.get(key)
    if (!pending) {
      pending = page(key)
      cache.set(key, pending)
      if (cache.size > 100) cache.delete(cache.keys().next().value)
      setTimeout(() => cache.delete(key), 15_000).unref()
    }
    const html = await pending
    res.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'public, max-age=0, s-maxage=15, stale-while-revalidate=300',
    })
    res.end(html)
  } catch (error) {
    console.error('SSR failed', error)
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' })
    res.end(template)
  }
}).listen(Number(process.env.PORT || 3000), '0.0.0.0', () => console.log(`SSR listening on :${process.env.PORT || 3000}`))
