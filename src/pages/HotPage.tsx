import { useEffect, useState } from 'react'
import { Flame } from 'lucide-react'
import { useStore } from '@/lib/store'
import Stamp from '@/components/Stamp'
import Reveal from '@/components/Reveal'
import PaywallBadge from '@/components/PaywallBadge'
import ArticleForesightLink from '@/components/ArticleForesightLink'
import { commentCount, hotness } from '@/lib/analytics'
import { fetchRanked } from '@/lib/remoteFeed'
import { SOURCE_URL } from '@/config/site'
import type { Article } from '@/types/types'

type Period = 'day' | 'week' | 'month'
const PERIODS: { key: Period; label: string; days: number }[] = [
  { key: 'day', label: 'За день', days: 1 },
  { key: 'week', label: 'За неделю', days: 7 },
  { key: 'month', label: 'За месяц', days: 30 },
]

/** Дайджест «Горячее»: ранжирование по горячести за выбранный период (окно — services/feed/src/rank.rs) */
export default function HotPage() {
  const { articles, unlocked, upvotes } = useStore()
  const [period, setPeriod] = useState<Period>('week')
  // ранжирует сервер по всему индексу; пока не ответил или индекс пуст — локальная оценка загруженного
  const [ranked, setRanked] = useState<{ period: Period; list: { a: Article; score: number }[] } | null>(null)
  useEffect(() => {
    let alive = true
    fetchRanked({ sort: 'hot', period, limit: 50 }).then(
      (r) => alive && setRanked({ period, list: r.map(({ article, score }) => ({ a: article, score })) }),
    )
    return () => {
      alive = false
    }
  }, [period])
  const now = new Date().toISOString()
  const since = Date.parse(now) - PERIODS.find((p) => p.key === period)!.days * 86_400_000
  const local = articles
    .filter((a) => !a.publishAt || a.publishAt <= now)
    .filter((a) => (Date.parse(a.publishedAtFull ?? a.publishedAt) || 0) >= since)
    .map((a) => ({ a, score: Math.round(hotness(a, upvotes.includes(a.id)) * 1000) / 10 }))
    .sort((x, y) => y.score - x.score)
  // карточка из стора знает о моём лайке и свежих комментариях — берём её, если есть
  const byId = new Map(articles.map((a) => [a.id, a]))
  const server = ranked?.period === period ? ranked.list : null
  const hot = server?.length
    ? server.map(({ a, score }) => ({ a: byId.get(a.id) ?? a, score: Math.round(score * 1000) / 10 }))
    : local

  return (
    <div className="mx-auto max-w-[860px] px-5 pb-24 md:px-8">
      <div className="pb-8 pt-10">
        <p className="meta">Дайджест · порядок обновляется раз в минуту</p>
        <h1 className="mt-2 inline-flex items-center gap-3 text-4xl font-extrabold tracking-tight md:text-5xl">
          <Flame size={34} className="text-accent" aria-hidden="true" /> Горячее
        </h1>
        <p className="mt-4 max-w-[64ch] text-[15px] leading-relaxed text-muted-foreground">
          Лайки и комментарии делятся на возраст записи: (лайки + 2 × комментарии + 1) / (часы + 2)^1.5. Никакой
          ручной модерации —{' '}
          <a href={`${SOURCE_URL}/blob/main/services/feed/src/rank.rs`} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">
            алгоритм открыт
          </a>
          , его можно форкнуть и запустить свой дайджест.
        </p>
        <div role="group" aria-label="Период" className="mt-6 inline-flex rounded-full border border-border bg-secondary/60 p-1">
          {PERIODS.map((p) => (
            <button
              key={p.key}
              type="button"
              aria-pressed={period === p.key}
              onClick={() => setPeriod(p.key)}
              className={`cursor-pointer rounded-full px-4 py-1.5 font-mono text-[12px] font-semibold uppercase tracking-[0.05em] transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                period === p.key ? 'bg-primary text-primary-foreground' : 'text-foreground hover:text-accent'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <ol>
        {hot.map(({ a, score }, i) => (
          <Reveal key={a.id}>
            <li className="rule py-6 first:border-t-0">
              <div className="flex items-baseline gap-4">
                <span className={`font-mono text-2xl font-bold ${i < 3 ? 'text-accent' : 'text-border'}`}>
                  {i + 1}
                </span>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Stamp verdict={a.verdict} small />
                    <span className="meta">score {score}</span>
                  </div>
                  <h2 className="mt-1.5 text-xl font-extrabold leading-snug tracking-tight">
                    <ArticleForesightLink
                      article={a}
                      className="decoration-accent decoration-2 underline-offset-4 hover:underline"
                    >
                      {a.title}
                      <PaywallBadge hasPaywall={!!a.paywall} unlocked={!!unlocked[a.id]} />
                    </ArticleForesightLink>
                  </h2>
                  <p className="meta mt-1.5">
                    @{a.author.handle} · {commentCount(a)} коммент. · {a.readingTime} мин
                  </p>
                </div>
              </div>
            </li>
          </Reveal>
        ))}
      </ol>
    </div>
  )
}
