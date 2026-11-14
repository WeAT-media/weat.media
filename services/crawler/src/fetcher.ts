import { lookup as dnsLookup, type LookupAddress } from 'node:dns'
import ipaddr from 'ipaddr.js'
import { Agent, fetch as undiciFetch } from 'undici'
import { allowedByRobots, parseRobots } from './robots.js'

/**
 * Загрузка чужих страниц без SSRF: админ присылает произвольную ссылку, а краулер
 * работает внутри нашей сети рядом с PDS, Postgres и Redis.
 * IP проверяется в момент соединения (lookup агента) — подмена DNS между
 * проверкой и запросом (rebinding) не проходит.
 */

export class FetchError extends Error {
  constructor(
    readonly code: 'BadUrl' | 'Blocked' | 'Timeout' | 'TooLarge' | 'BadStatus' | 'BadType' | 'TooManyRedirects' | 'Network',
    message: string,
  ) {
    super(message)
  }
}

export interface FetchResult {
  url: string
  status: number
  contentType: string
  body: string
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

export interface FetcherOptions {
  userAgent: string
  timeoutMs?: number
  maxBytes?: number
  maxRedirects?: number
  /** только для тестов: разрешить loopback/приватные адреса */
  allowPrivate?: boolean
}

export function createFetcher(opts: FetcherOptions) {
  const timeoutMs = opts.timeoutMs ?? 15_000
  const maxBytes = opts.maxBytes ?? 5 * 1024 * 1024
  const maxRedirects = opts.maxRedirects ?? 5

  const agent = new Agent({
    connect: {
      lookup(hostname, options, cb) {
        dnsLookup(hostname, { ...options, all: true }, (err, addresses) => {
          if (err) return cb(err, '', 0)
          const list = (Array.isArray(addresses) ? addresses : [addresses]) as LookupAddress[]
          const bad = list.find((a) => !opts.allowPrivate && !isPublicAddress(a.address))
          if (bad) return cb(new FetchError('Blocked', `адрес ${bad.address} во внутренней сети`), '', 0)
          const first = list[0]
          if (!first) return cb(new Error('no address'), '', 0)
          if ((options as { all?: boolean }).all) return (cb as unknown as (e: null, a: LookupAddress[]) => void)(null, list)
          cb(null, first.address, first.family)
        })
      },
    },
  })

  const checkUrl = (raw: string): URL => {
    let u: URL
    try {
      u = new URL(raw)
    } catch {
      throw new FetchError('BadUrl', 'Некорректная ссылка')
    }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new FetchError('BadUrl', 'Только http(s)')
    if (u.username || u.password) throw new FetchError('BadUrl', 'Ссылки с логином и паролем не принимаются')
    // только стандартные порты: иначе краулер — сканер портов чужих хостов
    if (u.port && u.port !== '80' && u.port !== '443' && !opts.allowPrivate) throw new FetchError('Blocked', `порт ${u.port} не разрешён`)
    // IP-литерал проверяем сразу: lookup для него не вызывается
    const host = u.hostname.replace(/^\[|\]$/g, '')
    if (ipaddr.isValid(host) && !opts.allowPrivate && !isPublicAddress(host)) {
      throw new FetchError('Blocked', `адрес ${host} во внутренней сети`)
    }
    return u
  }

  // robots.txt по origin: кэш на час; нет файла — можно всё; сервер сайта сбоит — повтор позже
  const robotsCache = new Map<string, { at: number; rules: ReturnType<typeof parseRobots> }>()
  const robotsFor = async (u: URL) => {
    const hit = robotsCache.get(u.origin)
    if (hit && Date.now() - hit.at < 3_600_000) return hit.rules
    let rules: ReturnType<typeof parseRobots> = []
    try {
      const r = await fetchRaw(new URL('/robots.txt', u).toString(), 'text/plain', false)
      rules = parseRobots(r.body)
    } catch (err) {
      if (err instanceof FetchError && err.code === 'BadStatus' && /ответ 5\d\d/.test(err.message)) {
        throw new FetchError('BadStatus', 'robots.txt сайта временно недоступен (5xx) — повторим позже')
      }
      // 4xx, не текст, слишком большой — правил нет
    }
    if (robotsCache.size > 5000) robotsCache.clear()
    robotsCache.set(u.origin, { at: Date.now(), rules })
    return rules
  }

  /** страница источника; robots: false — без проверки robots.txt (сам robots.txt) */
  async function fetchPage(raw: string, accept = 'text/html,application/xhtml+xml,application/rss+xml,application/xml;q=0.9'): Promise<FetchResult> {
    return fetchRaw(raw, accept, true)
  }
  return fetchPage

  async function fetchRaw(raw: string, accept: string, robots: boolean): Promise<FetchResult> {
    let url = checkUrl(raw)
    for (let hop = 0; hop <= maxRedirects; hop++) {
      if (robots && !allowedByRobots(await robotsFor(url), url.pathname + url.search)) {
        throw new FetchError('Blocked', `robots.txt сайта ${url.hostname} запрещает загрузку ${url.pathname}`)
      }
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), timeoutMs)
      try {
        const res = await undiciFetch(url, {
          dispatcher: agent,
          redirect: 'manual',
          signal: ctrl.signal,
          headers: { 'user-agent': opts.userAgent, accept, 'accept-language': 'ru,en;q=0.8' },
        })
        if (res.status >= 300 && res.status < 400) {
          const loc = res.headers.get('location')
          await res.body?.cancel()
          if (!loc) throw new FetchError('BadStatus', `редирект без адреса (${res.status})`)
          url = checkUrl(new URL(loc, url).toString())
          continue
        }
        if (res.status !== 200) {
          await res.body?.cancel()
          throw new FetchError('BadStatus', `ответ ${res.status}`)
        }
        const contentType = res.headers.get('content-type') ?? ''
        if (!/html|xml/i.test(contentType)) {
          await res.body?.cancel()
          throw new FetchError('BadType', `не страница: ${contentType || 'без типа'}`)
        }
        const declared = Number(res.headers.get('content-length') ?? 0)
        if (declared > maxBytes) {
          await res.body?.cancel()
          throw new FetchError('TooLarge', 'страница больше 5 МБ')
        }
        const chunks: Uint8Array[] = []
        let size = 0
        for await (const chunk of res.body ?? []) {
          size += (chunk as Uint8Array).byteLength
          if (size > maxBytes) {
            ctrl.abort()
            throw new FetchError('TooLarge', 'страница больше 5 МБ')
          }
          chunks.push(chunk as Uint8Array)
        }
        return { url: url.toString(), status: res.status, contentType, body: decodeBody(Buffer.concat(chunks), contentType) }
      } catch (err) {
        if (err instanceof FetchError) throw err
        const cause = (err as { cause?: unknown }).cause
        if (cause instanceof FetchError) throw cause
        if ((err as Error).name === 'AbortError') throw new FetchError('Timeout', `нет ответа за ${timeoutMs / 1000} с`)
        throw new FetchError('Network', (err as Error).message)
      } finally {
        clearTimeout(timer)
      }
    }
    throw new FetchError('TooManyRedirects', 'слишком много редиректов')
  }
}

export type FetchPage = ReturnType<typeof createFetcher>

/** Канонический адрес: без utm/фрагмента и хвостового слэша — ключ дедупликации */
export function canonicalUrl(raw: string): string {
  const u = new URL(raw)
  u.hash = ''
  for (const k of [...u.searchParams.keys()]) if (/^(utm_|fbclid|gclid|yclid|ref$)/i.test(k)) u.searchParams.delete(k)
  u.hostname = u.hostname.toLowerCase().replace(/^www\./, '')
  let s = u.toString()
  if (s.endsWith('/') && u.pathname !== '/') s = s.slice(0, -1)
  return s
}

/**
 * Кодировка: заголовок Content-Type, затем <meta charset> / <?xml encoding> в первых 2 КБ, иначе UTF-8.
 * Старые русские сайты (opennet и др.) отдают koi8-r и windows-1251.
 */
export function decodeBody(buf: Buffer, contentType: string | null | undefined): string {
  const fromHeader = /charset=["']?([\w-]+)/i.exec(contentType ?? '')?.[1]
  const head = buf.subarray(0, 2048).toString('latin1')
  const fromDoc =
    /<meta[^>]+charset=["']?([\w-]+)/i.exec(head)?.[1] ?? /<\?xml[^>]+encoding=["']([\w-]+)/i.exec(head)?.[1]
  for (const label of [fromHeader, fromDoc]) {
    if (!label) continue
    try {
      return new TextDecoder(label.toLowerCase()).decode(buf)
    } catch {
      // неизвестная кодировка — пробуем следующую подсказку
    }
  }
  return buf.toString('utf8')
}
