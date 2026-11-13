import { useEffect, useState, type RefObject } from 'react'
import { hasSession } from '@/lib/api'
import type { RealStats } from '@/lib/analytics'
import { lastTouchUtm, parseUtm } from '@/lib/utm'
import { analyticsAllowed } from '@/lib/consent'

/**
 * Открытая аналитика: beacon в weat-analytics. Без cookie и идентификаторов —
 * сервис считает дневной хеш сам и не хранит IP. DNT/GPC браузера — не отправляем ничего.
 */
const BASE = import.meta.env.VITE_ANALYTICS_URL ?? '/analytics-api'

const optedOut = () =>
  typeof navigator !== 'undefined' &&
  (navigator.doNotTrack === '1' || (navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl === true)

function send(payload: Record<string, unknown>) {
  if (optedOut()) return
  // ЕЭЗ/UK/CH — только с согласия (consent.ts); остальным — как раньше
  void analyticsAllowed().then((ok) => ok && beacon(payload))
}

function beacon(payload: Record<string, unknown>) {
  const body = JSON.stringify(payload)
  // text/plain — простой запрос без CORS-preflight; sendBeacon переживает закрытие вкладки
  if (navigator.sendBeacon?.(`${BASE}/collect`, new Blob([body], { type: 'text/plain' }))) return
  fetch(`${BASE}/collect`, { method: 'POST', body, keepalive: true, headers: { 'content-type': 'text/plain' } }).catch(() => {})
}

// document.referrer в SPA не меняется: внешний referrer относится только к первой открытой странице
const landing = typeof window !== 'undefined' ? window.location.pathname : ''
let navigated = false

/** доля длительности, которую нужно реально просмотреть, чтобы досмотр засчитался */
export const COMPLETE_SHARE = 0.9

/**
 * Запуск и досмотр видео — сигнал ранжирования видео (services/feed/src/completions.rs).
 * Досмотр — по накопленному времени воспроизведения, а не по позиции: перемотка в конец не засчитывается.
 * Возвращает обработчики для плеера; повторы в пределах ролика не шлём (дедуп ещё и на сервере).
 */
export function videoTracker(articleId: string) {
  let played = false
  let completed = false
  let watched = 0
  let last: number | null = null
  return {
    onPlay() {
      if (played) return
      played = true
      send({ a: articleId, k: 'play' })
    },
    /** t — текущая позиция; шаг больше 2 с — перемотка, его не считаем */
    onTime(t: number, duration: number) {
      if (last !== null && t > last && t - last <= 2) watched += t - last
      last = t
      if (!completed && duration > 0 && watched >= duration * COMPLETE_SHARE) {
        completed = true
        send({ a: articleId, k: 'complete' })
      }
    },
  }
}

/** просмотр, дочитывание (низ статьи в зоне видимости) и время на странице (только при видимой вкладке) */
export function useArticleTracking(articleId: string | undefined, endRef: RefObject<Element | null>) {
  useEffect(() => {
    if (!articleId) return
    const internal = navigated || window.location.pathname !== landing
    navigated = true
    const utm = parseUtm(new URLSearchParams(window.location.search)) ?? lastTouchUtm()
    send({
      a: articleId,
      k: 'view',
      r: internal ? window.location.origin : document.referrer || undefined,
      u: utm && { source: utm.source, medium: utm.medium ?? '', campaign: utm.campaign ?? '' },
      auth: hasSession(),
    })

    let visibleMs = 0
    let since = document.visibilityState === 'visible' ? performance.now() : null
    let sentTime = false
    const flushTime = () => {
      if (since !== null) visibleMs += performance.now() - since
      since = null
      if (!sentTime && visibleMs >= 1000) {
        sentTime = true
        send({ a: articleId, k: 'time', ms: Math.min(Math.round(visibleMs), 7_200_000) })
      }
    }
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flushTime()
      else if (!sentTime) since = performance.now()
    }
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pagehide', flushTime)

    let read = false
    const io = new IntersectionObserver((entries) => {
      if (!read && entries.some((e) => e.isIntersecting)) {
        read = true
        send({ a: articleId, k: 'read' })
        io.disconnect()
      }
    })
    if (endRef.current) io.observe(endRef.current)

    return () => {
      flushTime()
      io.disconnect()
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pagehide', flushTime)
    }
  }, [articleId, endRef])
}

/** реальные агрегаты; null — сервис недоступен или просмотров ещё нет */
export function useArticleStats(articleId: string | undefined, days = 14): RealStats | null | undefined {
  const [stats, setStats] = useState<{ id: string; data: RealStats | null } | null>(null)
  useEffect(() => {
    if (!articleId) return
    let alive = true
    fetch(`${BASE}/articles/${encodeURIComponent(articleId)}?days=${days}`)
      .then((r) => (r.ok ? (r.json() as Promise<RealStats>) : null))
      .catch(() => null)
      .then((data) => alive && setStats({ id: articleId, data: data && data.views > 0 ? data : null }))
    return () => {
      alive = false
    }
  }, [articleId, days])
  // undefined — ещё загружается
  return stats && stats.id === articleId ? stats.data : undefined
}
