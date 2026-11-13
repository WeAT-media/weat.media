import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { ArrowUpRight, CheckCircle2, Gavel, Scale, Search, Vote } from 'lucide-react'
import { useStore } from '@/lib/store'
import Reveal from '@/components/Reveal'
import Stamp from '@/components/Stamp'

type Filter = 'all' | 'open' | 'closed'

/**
 * Реестр судебных дел: все дела из store (seed + созданные через «вынести на суд»).
 * Фильтры все/активные/завершённые, поиск по номеру и названию статьи.
 */
export default function CasesPage() {
  const { cases, caseStats } = useStore()
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return cases
      .filter((c) => (filter === 'all' ? true : filter === 'open' ? c.status === 'open' : c.status === 'closed'))
      .filter((c) => !q || c.number.toLowerCase().includes(q) || c.articleTitle.toLowerCase().includes(q))
      .sort((a, b) => b.openedAt.localeCompare(a.openedAt))
  }, [cases, filter, query])

  const openCount = cases.filter((c) => c.status === 'open').length
  const closedCount = cases.length - openCount
  const quorumReached = cases.filter((c) => {
    const s = caseStats(c)
    return s.voted >= c.quorum
  }).length

  const stats = [
    { label: 'Всего дел', value: String(cases.length), icon: Scale },
    { label: 'Принимают голоса', value: String(openCount), icon: Vote },
    { label: 'Завершены', value: String(closedCount), icon: CheckCircle2 },
    { label: 'Кворум достигнут', value: String(quorumReached), icon: Gavel },
  ]

  const filters: { key: Filter; label: string }[] = [
    { key: 'all', label: 'Все' },
    { key: 'open', label: 'Активные' },
    { key: 'closed', label: 'Завершённые' },
  ]

  return (
    <div className="mx-auto max-w-[1100px] px-5 pb-24 md:px-8">
      <div className="pt-10">
        <p className="meta inline-flex items-center gap-1.5">
          <Gavel size={12} className="text-accent" aria-hidden="true" /> Суд присяжных · открытый реестр
        </p>
        <h1 className="mt-2 text-4xl font-extrabold tracking-tight md:text-5xl">Реестр дел</h1>
        <p className="mt-4 max-w-[64ch] text-[15px] leading-relaxed text-muted-foreground">
          Каждое разбирательство публично: состав коллегии анонимен, но ход голосования, кворум и вердикт
          открыты всем. Метка выходит подписанной коллегией, а не модератором.
        </p>
      </div>

      <Reveal className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className="border border-border bg-secondary/40 p-4">
            <p className="flex items-center gap-2.5 text-xl font-extrabold tracking-tight">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent" aria-hidden="true">
                <s.icon size={14} />
              </span>
              {s.value}
            </p>
            <p className="meta mt-1.5">{s.label}</p>
          </div>
        ))}
      </Reveal>

      <Reveal className="mt-8">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex gap-2" role="tablist" aria-label="Фильтр дел">
            {filters.map((f) => (
              <button
                key={f.key}
                type="button"
                role="tab"
                aria-selected={filter === f.key}
                onClick={() => setFilter(f.key)}
                className={`cursor-pointer rounded-full border px-4 py-1.5 font-mono text-[12px] font-semibold uppercase tracking-[0.05em] transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  filter === f.key
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-border text-foreground hover:border-accent hover:text-accent'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
          <div className="relative min-w-56 flex-1">
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Номер дела или название статьи…"
              aria-label="Поиск по делам"
              className="w-full rounded-md border border-input bg-background py-2 pl-9 pr-3 font-mono text-[13px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
        </div>

        <ul className="mt-6 space-y-4">
          {visible.length === 0 && (
            <li className="border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
              Дел не найдено{query ? ` по запросу «${query}»` : ''}.
            </li>
          )}
          {visible.map((c) => {
            const s = caseStats(c)
            const pct = Math.min(100, (s.voted / c.jurorsTotal) * 100)
            return (
              <li key={c.id}>
                <Link
                  to={`/case/${c.id}`}
                  className="group block border border-border bg-background p-5 transition-colors hover:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="font-mono text-[13px] font-bold tracking-[0.08em]">{c.number}</p>
                    <div className="flex items-center gap-3">
                      <span className="meta">{c.openedAt}</span>
                      {s.closed ? (
                        <Stamp verdict={s.outcome === 'guilty' ? 'guilty' : 'acquitted'} small />
                      ) : (
                        <span className="meta rounded-full border border-border px-2.5 py-0.5 text-accent">
                          идёт голосование
                        </span>
                      )}
                    </div>
                  </div>
                  <p className="mt-2.5 flex items-start gap-1.5 text-[15px] font-semibold leading-snug">
                    <span className="min-w-0">{c.articleTitle}</span>
                    <ArrowUpRight size={14} className="mt-1 shrink-0 text-muted-foreground transition-transform duration-200 group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-accent" aria-hidden="true" />
                  </p>
                  <p className="mt-1.5 max-w-[72ch] text-sm leading-relaxed text-muted-foreground">{c.charges}</p>
                  <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2">
                    <span className="meta">виновна: {s.guilty} · невиновна: {s.clear}</span>
                    <div className="flex min-w-44 flex-1 items-center gap-2">
                      <div
                        className="h-1.5 flex-1 overflow-hidden rounded-full bg-secondary"
                        role="progressbar"
                        aria-valuenow={s.voted}
                        aria-valuemin={0}
                        aria-valuemax={c.jurorsTotal}
                        aria-label={`Прогресс кворума: ${s.voted} из ${c.jurorsTotal}`}
                      >
                        <div className="h-full bg-accent" style={{ width: `${pct}%` }} />
                      </div>
                      <span className="meta shrink-0">
                        {s.voted}/{c.jurorsTotal} · кворум {c.quorum}
                      </span>
                    </div>
                  </div>
                </Link>
              </li>
            )
          })}
        </ul>
      </Reveal>
    </div>
  )
}
