import type { ApiUser } from '@/lib/api'
import type { Article } from '@/types/types'

export interface FeedPage {
  key: string
  articles: Article[]
  total: number
}

export interface SsrData {
  path: string
  /** момент серверного рендера: окна «день/неделя» на клиенте считаются от него же, иначе гидрация расходится */
  renderedAt?: number
  articles?: Article[]
  feed?: FeedPage
  hot?: { period: 'day' | 'week' | 'month'; list: { a: Article; score: number }[] }
  profile?: ApiUser
}

let cached: SsrData | undefined

export function ssrData(): SsrData | undefined {
  if (cached) return cached
  const injected = (globalThis as typeof globalThis & { __WEAT_SSR__?: SsrData }).__WEAT_SSR__
  if (injected) return (cached = injected)
  if (typeof document === 'undefined') return undefined
  const json = document.getElementById('weat-ssr-data')?.textContent
  if (!json) return undefined
  try {
    cached = JSON.parse(json) as SsrData
  } catch {
    return undefined
  }
  return cached
}

/** «Сейчас» для расчётов при рендере: на странице, пришедшей с сервера, — время серверного рендера */
export function ssrNow(): number {
  const data = ssrData()
  if (data?.renderedAt && (typeof location === 'undefined' || data.path === location.pathname)) return data.renderedAt
  return Date.now()
}
