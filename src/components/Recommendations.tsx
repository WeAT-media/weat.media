import { Link } from 'react-router'
import { Flame } from 'lucide-react'
import { useStore } from '@/lib/store'

/**
 * Рекомендательный блок BigData-движка: скоринг по «горячести», общим тегам
 * и мок-поведенческим сигналам. В кабинете показываем удержание и CTR.
 */
export default function Recommendations({ excludeId }: { excludeId?: string }) {
  const { articles } = useStore()
  const current = articles.find((a) => a.id === excludeId)

  const scored = articles
    .filter((a) => a.id !== excludeId)
    .map((a) => {
      const overlap = current ? a.tags.filter((t) => current.tags.includes(t)).length : 0
      const score = (a.hotScore ?? 0) + overlap * 12
      return { a, score }
    })
    .sort((x, y) => y.score - x.score)
    .slice(0, 3)

  if (scored.length === 0) return null

  return (
    <section aria-label="Рекомендации" className="rule mt-12 pt-8">
      <h2 className="inline-flex items-center gap-2 font-mono text-[13px] font-bold uppercase tracking-[0.12em]">
        <Flame size={14} className="text-accent" aria-hidden="true" /> Читать дальше
      </h2>
      <ul className="mt-5">
        {scored.map(({ a, score }, i) => (
          <li key={a.id} className="rule py-4 first:border-t-0">
            <Link
              to={`/article/${a.id}`}
              className="group flex items-baseline gap-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="meta w-6 shrink-0 text-accent">0{i + 1}</span>
              <span className="min-w-0">
                <span className="block truncate text-[15px] font-semibold decoration-accent underline-offset-4 group-hover:underline">
                  {a.title}
                </span>
                <span className="meta mt-1 block">
                  @{a.author.handle} · score {score} · {a.readingTime} мин
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}
