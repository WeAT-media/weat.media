import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { MessageSquare, Trophy, ArrowBigUp } from 'lucide-react'
import { commentCount, upvoteCount } from '@/lib/analytics'
import type { Article } from '@/types/types'

type Period = 'day' | 'week'
type Metric = 'comments' | 'upvotes'
type Origin = 'all' | 'internal' | 'external'

const DAY = 86_400_000

/** внутренние — написаны на площадке; внешние — свои PDS, краулер, репосты */
const isInternal = (a: Article) => (a.sourceType ?? 'native-pds') === 'native-pds'

/** «Лучшее»: топ-5 за день или неделю по комментариям или голосам, с фильтром источника */
export default function FeedBest({ articles, upvoted }: { articles: Article[]; upvoted: string[] }) {
  const [period, setPeriod] = useState<Period>('week')
  const [metric, setMetric] = useState<Metric>('upvotes')
  const [origin, setOrigin] = useState<Origin>('all')
  // момент открытия ленты: окно «день/неделя» считается от него
  const [now] = useState(() => Date.now())

  const top = useMemo(() => {
    // publishedAt — дата без времени: «день» = сегодня и вчера, «неделя» = 7 суток
    const since = now - (period === 'day' ? 2 : 7) * DAY
    const score = (a: Article) => (metric === 'comments' ? commentCount(a) : upvoteCount(a, upvoted.includes(a.id)))
    return articles
      .filter((a) => Date.parse(a.publishedAt) >= since)
      .filter((a) => origin === 'all' || (origin === 'internal') === isInternal(a))
      .map((a) => ({ a, score: score(a) }))
      .sort((x, y) => y.score - x.score)
      .slice(0, 5)
  }, [articles, upvoted, period, metric, origin, now])

  const seg = <T extends string>(value: T, set: (v: T) => void, opts: { key: T; label: string }[], label: string) => (
    <div role="group" aria-label={label} className="flex rounded-full border border-border bg-secondary/60 p-0.5">
      {opts.map((o) => (
        <button
          key={o.key}
          type="button"
          aria-pressed={value === o.key}
          onClick={() => set(o.key)}
          className={`flex-1 cursor-pointer rounded-full px-2.5 py-1 font-mono text-[11px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
            value === o.key ? 'bg-primary text-primary-foreground' : 'text-foreground hover:text-accent'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )

  return (
    <section className="border border-border bg-secondary/30 p-4" aria-labelledby="best-h">
      <h2 id="best-h" className="flex items-center gap-2 font-mono text-[13px] font-bold uppercase tracking-[0.12em]">
        <Trophy size={14} className="text-accent" aria-hidden="true" /> Лучшее
      </h2>
      <div className="mt-3 grid gap-1.5">
        {seg(period, setPeriod, [{ key: 'day', label: 'За день' }, { key: 'week', label: 'За неделю' }], 'Период')}
        {seg(metric, setMetric, [{ key: 'upvotes', label: 'Голоса' }, { key: 'comments', label: 'Комментарии' }], 'Критерий')}
        {seg(origin, setOrigin, [{ key: 'all', label: 'Все' }, { key: 'internal', label: 'Внутренние' }, { key: 'external', label: 'Внешние' }], 'Источник')}
      </div>
      {top.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">За этот период публикаций нет.</p>
      ) : (
        <ol className="mt-4 space-y-3">
          {top.map(({ a, score }, i) => (
            <li key={a.id} className="flex gap-3">
              <span className="font-mono text-lg font-bold leading-none text-accent">{i + 1}</span>
              <div className="min-w-0">
                <Link to={`/article/${a.id}`} className="block text-sm font-semibold leading-snug underline-offset-4 hover:text-accent hover:underline">
                  {a.title}
                </Link>
                <span className="meta mt-1 inline-flex items-center gap-1">
                  {metric === 'comments' ? <MessageSquare size={11} aria-hidden="true" /> : <ArrowBigUp size={12} aria-hidden="true" />}
                  {score} · @{a.author.handle}
                </span>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
