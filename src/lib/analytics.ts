import type { Article } from '@/types/types'
import { SITE_NAME } from '@/config/site'

/** Детерминированный хэш по строке — чтобы мок-числа стабильны между сессиями */
function hash32(s: string): number {
  let h = 2166136261
  for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619)
  return Math.abs(h)
}

/** Голоса статьи: лайки из индекса (мой учтён по likedByMe); у своей записи вне индекса — только мой; mine — состояние кнопки */
export function upvoteCount(a: Article, mine: boolean): number {
  return Math.max(0, (a.likeCount ?? 0) - (a.likedByMe ? 1 : 0) + (mine ? 1 : 0))
}

/**
 * «Горячесть» — та же формула, что на сервере (services/feed/src/rank.rs): (лайки + 2·комментарии + 1) / (часы + 2)^1.5.
 * Нужна для своих записей, которых ещё нет в индексе, — чтобы встать в серверный список по тому же score.
 */
export function hotness(a: Article, mine: boolean, now = Date.now()): number {
  const at = Date.parse(a.publishedAtFull ?? a.publishedAt) || 0
  const hours = Math.max(0, (now - at) / 3_600_000)
  return (upvoteCount(a, mine) + 2 * commentCount(a) + 1) / Math.pow(hours + 2, 1.5)
}

/** Комментарии: индекс знает обо всех, локальный список — только о загруженных */
export function commentCount(a: Article): number {
  return Math.max(a.commentCount ?? 0, a.comments.length)
}

export interface DailyPoint {
  day: string
  views: number
  completedReads: number
}

export interface ArticleAnalytics {
  views: number
  /** приблизительная оценка по модели (куки/сессии), не точный учёт */
  uniqueViewers: number
  avgReadTimeSec: number
  completionPct: number
  upvotes: number
  comments: number
  /** null — показов в ленте не считаем, CTR неизвестен */
  ctrPct: number | null
  daily: DailyPoint[]
  sources: { name: string; pct: number }[]
  anonymousPct: number
  maxSourcePct: number
  spikeRatio: number
  signals: { ok: boolean; label: string }[]
  status: 'clean' | 'review'
  /** true — данные сервиса аналитики; false — демо-модель */
  real: boolean
  utm: { source: string; medium: string; campaign: string; views: number }[]
}

/** Ответ weat-analytics: GET /analytics-api/articles/:id */
export interface RealStats {
  views: number
  uniques: number
  anon_views: number
  reads: number
  avg_time_ms: number
  daily: { day: string; views: number; uniques: number; reads: number }[]
  sources: { channel: 'feed' | 'direct' | 'search' | 'social' | 'other'; name: string; views: number }[]
  utm: { source: string; medium: string; campaign: string; views: number }[]
}

/** статья из сети без просмотров (или сервис аналитики недоступен): честные нули, а не модель */
export const EMPTY_STATS: RealStats = { views: 0, uniques: 0, anon_views: 0, reads: 0, avg_time_ms: 0, daily: [], sources: [], utm: [] }

const CHANNEL_LABEL: Record<RealStats['sources'][number]['channel'], string> = {
  feed: `Лента ${SITE_NAME}`,
  direct: 'Прямые ссылки',
  search: 'Поисковики',
  social: 'Соцсети',
  other: 'Другие сайты',
}

function antiFraudSignals(views: number, comments: number, spike: boolean, spikeRatio: number, anonymousPct: number, maxSourcePct: number) {
  const commentPer1k = views > 0 ? (comments / views) * 1000 : 0
  const signals = [
    {
      ok: !(spike && commentPer1k < 0.4),
      label: `Всплеск просмотров ×${spikeRatio} ${spike ? 'есть' : 'нет'}; комментариев на 1000 просмотров: ${commentPer1k.toFixed(1)}`,
    },
    { ok: anonymousPct <= 55, label: `Доля анонимных просмотров: ${anonymousPct}% (порог внимания 55%)` },
    { ok: maxSourcePct <= 55, label: `Концентрация источника: максимум ${maxSourcePct}% с одного канала` },
  ]
  return { signals, status: (signals.filter((x) => !x.ok).length >= 2 ? 'review' : 'clean') as 'review' | 'clean' }
}

/** Реальные агрегаты сервиса → та же форма, что у демо-модели */
export function fromRealStats(article: Article, upvotes: number, r: RealStats): ArticleAnalytics {
  const pct = (n: number, of: number) => (of > 0 ? Math.round((n / of) * 100) : 0)
  // каналы с подробностями: «Соцсети · Telegram»
  const sources = r.sources.map((x) => ({ name: x.name ? `${CHANNEL_LABEL[x.channel]} · ${x.name}` : CHANNEL_LABEL[x.channel], pct: pct(x.views, r.views) }))
  const daily = r.daily.map((d) => ({ day: d.day.slice(5), views: d.views, completedReads: d.reads }))
  const active = daily.filter((d) => d.views > 0)
  const avg = active.length ? active.reduce((a, d) => a + d.views, 0) / active.length : 0
  const maxViews = Math.max(0, ...daily.map((d) => d.views))
  const spikeRatio = avg > 0 ? Math.round((maxViews / avg) * 10) / 10 : 0
  const anonymousPct = pct(r.anon_views, r.views)
  const maxSourcePct = Math.max(0, ...sources.map((x) => x.pct))
  // всплеск значим только на заметном объёме
  const { signals, status } = antiFraudSignals(r.views, article.comments.length, spikeRatio >= 3 && maxViews >= 50, spikeRatio, anonymousPct, maxSourcePct)
  return {
    views: r.views,
    uniqueViewers: r.uniques,
    avgReadTimeSec: Math.round(r.avg_time_ms / 1000),
    completionPct: pct(r.reads, r.uniques || r.views),
    upvotes,
    comments: article.comments.length,
    ctrPct: null,
    daily,
    sources,
    anonymousPct,
    maxSourcePct,
    spikeRatio,
    signals,
    status,
    real: true,
    utm: r.utm,
  }
}

/**
 * Открытая аналитика статьи: демо-данные, детерминированно выведенные из статьи.
 * Никаких персональных данных — только агрегаты и оценки по модели.
 */
export function getArticleAnalytics(article: Article, upvotes: number): ArticleAnalytics {
  const h = hash32(article.id)
  const views = 400 + (h % 9000)
  const uniqueViewers = Math.round(views * (0.62 + (h % 20) / 100))
  const avgReadTimeSec = Math.min(article.readingTime * 60, 40 + (h % Math.max(60, article.readingTime * 45)))
  const completionPct = 28 + (h % 50)
  const comments = article.comments.length
  const ctrPct = Number((0.8 + (h % 40) / 10).toFixed(1))

  // динамика 14 дней: день публикации + назад; возможен всплеск
  const spikeDay = h % 11
  const hasSpike = h % 3 === 0
  const daily: DailyPoint[] = []
  const base = Math.max(20, Math.round(views / 14))
  const start = new Date(article.publishedAt + 'T00:00:00')
  for (let i = 0; i < 14; i++) {
    const d = new Date(start)
    d.setDate(d.getDate() - (13 - i))
    const jitter = (hash32(`${article.id}-${i}`) % 60) / 100 + 0.7
    let v = Math.round(base * jitter)
    if (hasSpike && i === spikeDay) v = Math.round(base * 4.2)
    daily.push({
      day: d.toISOString().slice(5, 10),
      views: v,
      completedReads: Math.round(v * (completionPct / 100)),
    })
  }

  const sources = [
    { name: `Лента ${SITE_NAME}`, pct: 30 + (h % 30) },
    { name: 'Прямые ссылки', pct: 15 + (h % 20) },
    { name: 'Внешние соцсети', pct: 10 + (h % 15) },
    { name: 'Поисковики', pct: 5 + (h % 10) },
  ]
  const total = sources.reduce((s, x) => s + x.pct, 0)
  for (const s of sources) s.pct = Math.round((s.pct / total) * 100)

  const anonymousPct = 20 + (h % 55)
  const maxSourcePct = Math.max(...sources.map((s) => s.pct))
  const maxViews = Math.max(...daily.map((d) => d.views))
  const spikeRatio = Math.round((maxViews / base) * 10) / 10

  const { signals, status } = antiFraudSignals(views, comments, hasSpike, spikeRatio, anonymousPct, maxSourcePct)

  return {
    views,
    uniqueViewers,
    avgReadTimeSec,
    completionPct,
    upvotes,
    comments,
    ctrPct,
    daily,
    sources,
    anonymousPct,
    maxSourcePct,
    spikeRatio,
    signals,
    status,
    real: false,
    utm: [],
  }
}
