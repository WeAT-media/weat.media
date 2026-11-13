import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { Flame } from 'lucide-react'
import { useStore } from '@/lib/store'
import Stamp from '@/components/Stamp'
import Reveal from '@/components/Reveal'
import PaywallBadge from '@/components/PaywallBadge'
import { commentCount, upvoteCount } from '@/lib/analytics'
import { fetchRanked } from '@/lib/remoteFeed'
import { SOURCE_URL } from '@/config/site'
import type { Article } from '@/types/types'

/** Дайджест «Горячее»: ранжирование BigData-движком по горячести */
export default function HotPage() {
  const { articles, unlocked, upvotes } = useStore()
  // ранжирует сервер по всему индексу; пока не ответил или индекс пуст — локальная оценка загруженного
  const [ranked, setRanked] = useState<{ a: Article; score: number }[] | null>(null)
  useEffect(() => {
    let alive = true
    fetchRanked({ sort: 'hot', limit: 50 }).then((r) => alive && setRanked(r.map(({ article, score }) => ({ a: article, score }))))
    return () => {
      alive = false
    }
  }, [])
  const now = new Date().toISOString()
  const local = articles
    .filter((a) => !a.publishAt || a.publishAt <= now)
    .map((a) => ({
      a,
      score: (a.hotScore ?? 0) + commentCount(a) * 2 + upvoteCount(a, upvotes.includes(a.id)),
    }))
    .sort((x, y) => y.score - x.score)
  // карточка из стора знает о моём лайке и свежих комментариях — берём её, если есть
  const byId = new Map(articles.map((a) => [a.id, a]))
  const hot = ranked?.length
    ? ranked.map(({ a, score }) => ({ a: byId.get(a.id) ?? a, score: Math.round(score * 1000) / 10 }))
    : local

  return (
    <div className="mx-auto max-w-[860px] px-5 pb-24 md:px-8">
      <div className="pb-8 pt-10">
        <p className="meta">Дайджест · обновляется каждые 15 минут</p>
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
                    <Link
                      to={`/article/${a.id}`}
                      className="decoration-accent decoration-2 underline-offset-4 hover:underline"
                    >
                      {a.title}
                      <PaywallBadge hasPaywall={!!a.paywall} unlocked={!!unlocked[a.id]} />
                    </Link>
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
