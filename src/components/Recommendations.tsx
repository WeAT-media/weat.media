import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { Flame } from 'lucide-react'
import { useStore } from '@/lib/store'
import { fetchRelated } from '@/lib/remoteFeed'
import type { Article } from '@/types/types'

/**
 * «Читать дальше»: для статьи из индекса — серверные рекомендации (общие теги и общие читатели,
 * services/feed/src/rank.rs); для своей локальной записи — статьи с общими тегами из загруженных.
 */
export default function Recommendations({ excludeId }: { excludeId?: string }) {
  const { articles } = useStore()
  const current = articles.find((a) => a.id === excludeId)
  const uri = current?.fromIndex ? current.atUri : undefined
  // к видео — видео: «досмотрел — смотри дальше»
  const kind = current?.kind === 'video' ? 'video' : undefined
  const [server, setServer] = useState<{ uri: string; list: Article[] } | null>(null)
  useEffect(() => {
    if (!uri) return
    let alive = true
    fetchRelated(uri, 3, kind).then((list) => alive && setServer({ uri, list }))
    return () => {
      alive = false
    }
  }, [uri, kind])

  const local = current
    ? articles
        .filter((a) => a.id !== excludeId)
        .map((a) => ({ a, overlap: a.tags.filter((t) => current.tags.includes(t)).length }))
        .filter((x) => x.overlap > 0)
        .sort((x, y) => y.overlap - x.overlap)
        .slice(0, 3)
        .map((x) => x.a)
    : []
  // карточка из стора знает о моём лайке и свежих комментариях — берём её, если есть
  const byId = new Map(articles.map((a) => [a.id, a]))
  const list = uri ? (server?.uri === uri ? server.list.map((a) => byId.get(a.id) ?? a) : []) : local

  if (list.length === 0) return null

  return (
    <section aria-label="Рекомендации" className="rule mt-12 pt-8">
      <h2 className="inline-flex items-center gap-2 font-mono text-[13px] font-bold uppercase tracking-[0.12em]">
        <Flame size={14} className="text-accent" aria-hidden="true" /> Читать дальше
      </h2>
      <ul className="mt-5">
        {list.map((a, i) => (
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
                  @{a.author.handle} · {a.tags.slice(0, 2).map((t) => `#${t}`).join(' ')} · {a.readingTime} мин
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}
