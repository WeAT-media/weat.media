/**
 * UTM-метки: utm_source / medium / campaign / term / content.
 * first touch — первая метка за 30 дней (атрибуция регистрации), last touch — метка текущего визита.
 * После захвата метки убираются из адреса: чтобы ссылку, скопированную читателем, не засчитали той же кампании.
 */

export interface Utm {
  source: string
  medium?: string
  campaign?: string
  term?: string
  content?: string
}

const KEYS = ['source', 'medium', 'campaign', 'term', 'content'] as const
const FIRST_KEY = 'indie-media:utm-first'
const LAST_KEY = 'indie-media:utm-last'
const TTL = 30 * 86_400_000

const clean = (v: string | null) => v?.trim().slice(0, 100) || undefined

/** метки из query; без utm_source набор не считается (как в GA/Метрике) */
export function parseUtm(search: URLSearchParams): Utm | null {
  const source = clean(search.get('utm_source'))
  if (!source) return null
  const utm: Utm = { source }
  for (const k of KEYS.slice(1)) {
    const v = clean(search.get(`utm_${k}`))
    if (v) utm[k] = v
  }
  return utm
}

/** параметры без utm_*; null — utm в адресе не было */
export function stripUtm(search: URLSearchParams): URLSearchParams | null {
  const next = new URLSearchParams(search)
  let had = false
  for (const k of [...next.keys()]) {
    if (k.startsWith('utm_')) {
      next.delete(k)
      had = true
    }
  }
  return had ? next : null
}

export function captureUtm(search: URLSearchParams): Utm | null {
  const utm = parseUtm(search)
  if (!utm) return null
  try {
    sessionStorage.setItem(LAST_KEY, JSON.stringify(utm))
    const first = localStorage.getItem(FIRST_KEY)
    const expired = !first || Date.now() - (JSON.parse(first) as { at: number }).at > TTL
    if (expired) localStorage.setItem(FIRST_KEY, JSON.stringify({ at: Date.now(), utm }))
  } catch {
    /* приватный режим: метка живёт только в этом визите */
  }
  return utm
}

/** first touch для регистрации */
export function firstTouchUtm(): Utm | undefined {
  try {
    const raw = localStorage.getItem(FIRST_KEY)
    if (!raw) return undefined
    const { at, utm } = JSON.parse(raw) as { at: number; utm: Utm }
    return Date.now() - at > TTL ? undefined : utm
  } catch {
    return undefined
  }
}

export function lastTouchUtm(): Utm | undefined {
  try {
    const raw = sessionStorage.getItem(LAST_KEY)
    return raw ? (JSON.parse(raw) as Utm) : undefined
  } catch {
    return undefined
  }
}

/** ссылка на материал с метками — для кнопки «Поделиться» и рассылок */
export function withUtm(url: string, utm: Utm): string {
  const u = new URL(url, typeof window !== 'undefined' ? window.location.origin : 'https://weat.media')
  for (const k of KEYS) {
    const v = utm[k]
    if (v) u.searchParams.set(`utm_${k}`, v)
  }
  return u.toString()
}
