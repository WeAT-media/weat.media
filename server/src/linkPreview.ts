import { lookup as dnsLookup, type LookupAddress } from 'node:dns'
import type { Context, Hono } from 'hono'
import ipaddr from 'ipaddr.js'
import { Agent, fetch as undiciFetch } from 'undici'

/**
 * Превью ссылки для редактора (карточка «/link» в BlockSuite): заголовок, описание, картинка, иконка из
 * Open Graph / <title>. Чужую страницу грузит AppView — поэтому без SSRF: только http(s) на 80/443,
 * IP проверяется в момент соединения (подмена DNS между проверкой и запросом не проходит), редиректы
 * вручную с той же проверкой, тело не больше 1 МБ. Только для вошедших; результат кэшируется на час.
 */

export interface LinkPreview {
  url: string
  title: string | null
  description: string | null
  image: string | null
  icon: string | null
}

export function isPublicAddress(ip: string): boolean {
  try {
    let addr = ipaddr.parse(ip)
    if (addr.kind() === 'ipv6' && (addr as ipaddr.IPv6).isIPv4MappedAddress()) addr = (addr as ipaddr.IPv6).toIPv4Address()
    return addr.range() === 'unicast'
  } catch {
    return false
  }
}

const MAX_BYTES = 1024 * 1024
const TIMEOUT_MS = 6000
const UA = 'Mozilla/5.0 (compatible; WEATLinkPreview/1.0; +https://weat.media/bot)'

const decode = (s: string) =>
  s
    .replace(/&#x([0-9a-f]+);/gi, (_m, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_m, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&(amp|lt|gt|quot|apos|#39|nbsp);/g, (_m, e: string) => ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'", nbsp: ' ' })[e]!)
    .replace(/\s+/g, ' ')
    .trim()

const attr = (tag: string, name: string) => new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag)?.slice(1).find((v) => v !== undefined)

/** разбор <head>: og:* → twitter:* → <title>/<meta description>; ссылки — абсолютные */
export function parsePreview(html: string, url: string): LinkPreview {
  const head = html.slice(0, 300_000)
  const meta = new Map<string, string>()
  for (const m of head.matchAll(/<meta\b[^>]*>/gi)) {
    const key = (attr(m[0], 'property') ?? attr(m[0], 'name') ?? '').toLowerCase()
    const content = attr(m[0], 'content')
    if (key && content && !meta.has(key)) meta.set(key, decode(content))
  }
  const abs = (v: string | undefined | null) => {
    if (!v) return null
    try {
      const u = new URL(v, url)
      return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null
    } catch {
      return null
    }
  }
  let icon: string | null = null
  for (const m of head.matchAll(/<link\b[^>]*>/gi)) {
    const rel = (attr(m[0], 'rel') ?? '').toLowerCase()
    if (/(^|\s)(icon|apple-touch-icon)(\s|$)/.test(rel)) {
      icon = abs(attr(m[0], 'href'))
      if (rel.includes('apple-touch-icon')) break
    }
  }
  const titleTag = /<title[^>]*>([^<]*)<\/title>/i.exec(head)?.[1]
  const pick = (...keys: string[]) => keys.map((k) => meta.get(k)).find((v) => v) ?? null
  const cut = (v: string | null, n: number) => (v ? v.slice(0, n) : null)
  return {
    url,
    title: cut(pick('og:title', 'twitter:title') ?? (titleTag ? decode(titleTag) : null), 300),
    description: cut(pick('og:description', 'twitter:description', 'description'), 500),
    image: abs(pick('og:image', 'og:image:url', 'twitter:image', 'twitter:image:src')),
    icon: icon ?? abs('/favicon.ico'),
  }
}

export function createPreviewFetcher(opts: { allowPrivate?: boolean } = {}) {
  const agent = new Agent({
    connect: {
      lookup(hostname, options, cb) {
        dnsLookup(hostname, { ...options, all: true }, (err, addresses) => {
          if (err) return cb(err, '', 0)
          const list = (Array.isArray(addresses) ? addresses : [addresses]) as LookupAddress[]
          const bad = list.find((a) => !opts.allowPrivate && !isPublicAddress(a.address))
          if (bad) return cb(new Error(`адрес ${bad.address} во внутренней сети`), '', 0)
          const first = list[0]
          if (!first) return cb(new Error('no address'), '', 0)
          if ((options as { all?: boolean }).all) return (cb as unknown as (e: null, a: LookupAddress[]) => void)(null, list)
          cb(null, first.address, first.family)
        })
      },
    },
  })

  const check = (raw: string): URL | null => {
    let u: URL
    try {
      u = new URL(raw)
    } catch {
      return null
    }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null
    if (u.username || u.password) return null
    if (u.port && u.port !== '80' && u.port !== '443' && !opts.allowPrivate) return null
    const host = u.hostname.replace(/^\[|\]$/g, '')
    if (ipaddr.isValid(host) && !opts.allowPrivate && !isPublicAddress(host)) return null
    return u
  }

  return async function preview(raw: string): Promise<LinkPreview | null> {
    let u = check(raw)
    for (let hop = 0; u && hop <= 4; hop++) {
      const res = await undiciFetch(u, {
        dispatcher: agent,
        redirect: 'manual',
        headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5', 'accept-language': 'ru,en;q=0.8' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      }).catch(() => null)
      if (!res) return null
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get('location')
        await res.body?.cancel()
        u = loc ? check(new URL(loc, u).toString()) : null
        continue
      }
      const type = res.headers.get('content-type') ?? ''
      if (!res.ok || !/html|xml/i.test(type)) {
        await res.body?.cancel()
        // картинка по прямой ссылке — сама себе превью
        return res.ok && type.startsWith('image/') ? { url: u.toString(), title: null, description: null, image: u.toString(), icon: null } : null
      }
      const chunks: Uint8Array[] = []
      let size = 0
      for await (const chunk of res.body as AsyncIterable<Uint8Array>) {
        chunks.push(chunk)
        size += chunk.byteLength
        // <head> всегда в начале — дальше не читаем
        if (size >= MAX_BYTES) break
      }
      const charset = /charset=([\w-]+)/i.exec(type)?.[1] ?? 'utf-8'
      let html: string
      try {
        html = new TextDecoder(charset).decode(Buffer.concat(chunks))
      } catch {
        html = new TextDecoder().decode(Buffer.concat(chunks))
      }
      return parsePreview(html, u.toString())
    }
    return null
  }
}

export function mountLinkPreviewRoutes(app: Hono, d: { authDid(c: Context): Promise<string | null>; preview?: (url: string) => Promise<LinkPreview | null> }) {
  const preview = d.preview ?? createPreviewFetcher()
  const cache = new Map<string, { at: number; value: LinkPreview | null }>()

  app.post('/link-preview', async (c) => {
    if (!(await d.authDid(c))) return c.json({ error: 'AuthenticationRequired', message: 'Нужно войти' }, 401)
    const body = (await c.req.json().catch(() => null)) as { url?: unknown } | null
    const url = typeof body?.url === 'string' ? body.url.trim().slice(0, 2000) : ''
    if (!url) return c.json({ error: 'InvalidRequest', message: 'Нет url' }, 400)
    c.header('cache-control', 'private, max-age=3600')
    const hit = cache.get(url)
    if (hit && Date.now() - hit.at < 3_600_000) return hit.value ? c.json(hit.value) : c.json({ error: 'NotFound', message: 'Нет превью' }, 404)
    const value = await preview(url).catch(() => null)
    if (cache.size > 2000) cache.delete(cache.keys().next().value!)
    cache.set(url, { at: Date.now(), value })
    return value ? c.json(value) : c.json({ error: 'NotFound', message: 'Не удалось получить превью' }, 404)
  })
}
