import { lookup as dnsLookup, type LookupAddress } from 'node:dns'
import ipaddr from 'ipaddr.js'
import { Agent, fetch as undiciFetch, type RequestInit as UndiciRequestInit } from 'undici'

export function isPublicAddress(ip: string): boolean {
  try {
    let addr = ipaddr.parse(ip)
    if (addr.kind() === 'ipv6' && (addr as ipaddr.IPv6).isIPv4MappedAddress()) addr = (addr as ipaddr.IPv6).toIPv4Address()
    return addr.range() === 'unicast'
  } catch {
    return false
  }
}

export type SafeFetch = (url: string | URL, init?: RequestInit) => Promise<Response>

export function createSafeFetch(opts: { allowPrivate?: boolean; maxRedirects?: number } = {}): SafeFetch {
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

  const check = (raw: string | URL): URL | null => {
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

  return async function safeFetch(raw, init = {}) {
    let u = check(raw)
    const maxRedirects = opts.maxRedirects ?? 4
    for (let hop = 0; u; hop++) {
      const res = (await undiciFetch(u, {
        ...(init as UndiciRequestInit),
        dispatcher: agent,
        redirect: 'manual',
      })) as unknown as Response
      if (res.status < 300 || res.status >= 400) return res
      if (hop >= maxRedirects) {
        await res.body?.cancel()
        throw new Error('Слишком много перенаправлений')
      }
      const loc = res.headers.get('location')
      await res.body?.cancel()
      u = loc ? check(new URL(loc, u)) : null
    }
    throw new Error('Небезопасный адрес перенаправления')
  }
}

export const safeFetch = createSafeFetch()

export async function readBodyLimited(res: Response, maxBytes: number): Promise<Buffer> {
  if (!res.body) return Buffer.alloc(0)
  const chunks: Uint8Array[] = []
  let size = 0
  for await (const chunk of res.body as AsyncIterable<Uint8Array>) {
    size += chunk.byteLength
    if (size > maxBytes) throw new Error(`Ответ больше ${maxBytes} байт`)
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}
