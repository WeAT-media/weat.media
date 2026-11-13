import { Link } from 'react-router'
import { Flame } from 'lucide-react'
import { useStore } from '@/lib/store'
import Stamp from '@/components/Stamp'
import Reveal from '@/components/Reveal'
import PaywallBadge from '@/components/PaywallBadge'
import { commentCount, upvoteCount } from '@/lib/analytics'

/** Дайджест «Горячее»: ранжирование BigData-движком по горячести */
export default function HotPage() {
  const { articles, unlocked, upvotes } = useStore()
  const now = new Date().toISOString()
  const hot = articles
    .filter((a) => !a.publishAt || a.publishAt <= now)
    .map((a) => ({
      a,
      score: (a.hotScore ?? 0) + commentCount(a) * 2 + upvoteCount(a, upvotes.includes(a.id)),
    }))
    .sort((x, y) => y.score - x.score)

  return (
    <div className="mx-auto max-w-[860px] px-5 pb-24 md:px-8">
      <div className="pb-8 pt-10">
        <p className="meta">Дайджест · обновляется каждые 15 минут</p>
        <h1 className="mt-2 inline-flex items-center gap-3 text-4xl font-extrabold tracking-tight md:text-5xl">
          <Flame size={34} className="text-accent" aria-hidden="true" /> Горячее
        </h1>
        <p className="mt-4 max-w-[64ch] text-[15px] leading-relaxed text-muted-foreground">
          Подборка, которую собирает BigData-движок: сигналы чтения, обсуждений и темпа набора просмотров.
          Никакой ручной модерации — алгоритм можно форкнуть и запустить свой дайджест.
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
                    @{a.author.handle} · {a.comments.length} коммент. · {a.readingTime} мин
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
