import { useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { ArrowLeft, FolderPlus } from 'lucide-react'
import { useStore } from '@/lib/store'
import Reveal from '@/components/Reveal'
import Stamp from '@/components/Stamp'
import PaywallBadge from '@/components/PaywallBadge'

export function CollectionsPage() {
  const { collections, articles, user, createCollection } = useStore()
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [error, setError] = useState('')

  const onCreate = (e: FormEvent) => {
    e.preventDefault()
    if (title.trim().length < 3) {
      setError('Название короткое — минимум 3 символа.')
      return
    }
    createCollection(title.trim(), description.trim())
    setTitle('')
    setDescription('')
    setError('')
  }

  return (
    <div className="mx-auto max-w-[860px] px-5 pb-24 md:px-8">
      <div className="pt-10">
        <Link
          to="/feed"
          className="inline-flex items-center gap-2 font-mono text-[12px] font-semibold uppercase tracking-[0.08em] text-muted-foreground transition-colors hover:text-accent"
        >
          <ArrowLeft size={13} aria-hidden="true" /> Лента
        </Link>
        <p className="meta mt-8">Серии и курсы авторов</p>
        <h1 className="mt-2 text-4xl font-extrabold tracking-tight md:text-5xl">Подборки</h1>
        <p className="mt-4 max-w-[64ch] text-[15px] leading-relaxed text-muted-foreground">
          Подборка — это упорядоченная серия записей одного автора: курс, дневник миграции, серия разборов.
          Записи остаются в репозитории автора; подборка лишь собирает их в один маршрут чтения.
        </p>
      </div>

      {user && (
        <Reveal className="mt-10">
          <form onSubmit={onCreate} className="border border-border bg-secondary/40 p-6" noValidate>
            <p className="meta inline-flex items-center gap-1.5">
              <FolderPlus size={12} aria-hidden="true" /> Новая подборка
            </p>
            <div className="mt-4 grid gap-4 md:grid-cols-[1fr_2fr_auto]">
              <input
                value={title}
                onChange={(e) => {
                  setTitle(e.target.value)
                  if (error) setError('')
                }}
                placeholder="Название"
                aria-label="Название подборки"
                className="rounded-md border border-input bg-background px-4 py-2.5 text-[15px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              <input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Описание (необязательно)"
                aria-label="Описание подборки"
                className="rounded-md border border-input bg-background px-4 py-2.5 text-[15px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              <button type="submit" className="btn-primary !py-2">Создать</button>
            </div>
            {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
          </form>
        </Reveal>
      )}

      <div className="mt-10">
        {collections.map((c) => {
          const count = c.articleIds.filter((id) => articles.some((a) => a.id === id)).length
          return (
            <Reveal key={c.id}>
              <Link
                to={`/collection/${c.id}`}
                className="group rule flex items-center justify-between gap-4 py-6 first:border-t-0"
              >
                <div>
                  <h2 className="text-xl font-extrabold tracking-tight decoration-accent underline-offset-4 group-hover:underline">
                    {c.title}
                  </h2>
                  <p className="mt-1.5 max-w-[60ch] text-sm leading-relaxed text-muted-foreground">{c.description}</p>
                  <p className="meta mt-2">
                    @{c.authorHandle} · {count} записей
                  </p>
                </div>
                <span className="meta shrink-0 text-accent">открыть →</span>
              </Link>
            </Reveal>
          )
        })}
      </div>
    </div>
  )
}

export function CollectionPage({ id }: { id?: string }) {
  const { collections, articles, unlocked } = useStore()
  const col = collections.find((c) => c.id === id)
  if (!col) {
    return (
      <div className="mx-auto max-w-[720px] px-5 py-24 text-center">
        <p className="meta">404 · подборка не найдена</p>
        <Link to="/collections" className="btn-ghost mt-8">
          <ArrowLeft size={14} aria-hidden="true" /> Все подборки
        </Link>
      </div>
    )
  }
  const items = col.articleIds
    .map((aid) => articles.find((a) => a.id === aid))
    .filter((a): a is NonNullable<typeof a> => Boolean(a))

  return (
    <div className="mx-auto max-w-[860px] px-5 pb-24 md:px-8">
      <div className="pt-10">
        <Link
          to="/collections"
          className="inline-flex items-center gap-2 font-mono text-[12px] font-semibold uppercase tracking-[0.08em] text-muted-foreground transition-colors hover:text-accent"
        >
          <ArrowLeft size={13} aria-hidden="true" /> Подборки
        </Link>
        <p className="meta mt-8">@{col.authorHandle} · подборка</p>
        <h1 className="mt-2 text-4xl font-extrabold tracking-tight md:text-5xl">{col.title}</h1>
        <p className="mt-4 max-w-[64ch] text-[15px] leading-relaxed text-muted-foreground">{col.description}</p>
      </div>
      <ol className="mt-10">
        {items.map((a, i) => (
          <Reveal key={a.id}>
            <li className="rule py-6 first:border-t-0">
              <div className="flex items-baseline gap-4">
                <span className="font-mono text-xl font-bold text-accent">{i + 1}</span>
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Stamp verdict={a.verdict} small />
                  </div>
                  <h2 className="mt-1 text-lg font-extrabold tracking-tight">
                    <Link to={`/article/${a.id}`} className="decoration-accent underline-offset-4 hover:underline">
                      {a.title}
                      <PaywallBadge hasPaywall={!!a.paywall} unlocked={!!unlocked[a.id]} />
                    </Link>
                  </h2>
                  <p className="meta mt-1">{a.readingTime} мин</p>
                </div>
              </div>
            </li>
          </Reveal>
        ))}
      </ol>
    </div>
  )
}
