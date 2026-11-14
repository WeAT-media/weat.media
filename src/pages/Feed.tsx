import { plainExcerpt } from '@/lib/plainText'
import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { ArrowUpRight, Clapperboard, Gavel, Lock, LockOpen, Plus, Sparkles, X } from 'lucide-react'
import { useStore } from '@/lib/store'
import Stamp from '@/components/Stamp'
import Reveal from '@/components/Reveal'
import TagAutocomplete from '@/components/TagAutocomplete'
import PaywallBadge from '@/components/PaywallBadge'
import UpvoteButton from '@/components/UpvoteButton'
import BookmarkButton from '@/components/BookmarkButton'
import FeedBest from '@/components/FeedBest'
import { prefetchArticle } from '@/lib/prefetch'
import { hotness } from '@/lib/analytics'
import { fetchRanked } from '@/lib/remoteFeed'
import type { Article } from '@/types/types'
import { LANGUAGES, languageName } from '@/data/languages'

function ArticleRow({ article, unlocked }: { article: Article; unlocked: boolean }) {
  return (
    <Reveal>
      <article className="rule py-7 first:border-t-0 first:pt-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="meta">{article.publishedAt}</span>
          <Stamp verdict={article.verdict} small />
        </div>
        <h2 className="mt-3 text-[22px] font-extrabold leading-snug tracking-tight md:text-2xl">
          <Link
            to={`/article/${article.id}`}
            onMouseEnter={() => prefetchArticle(article.id, article.atUri, article.bodyPending)}
            onFocus={() => prefetchArticle(article.id, article.atUri, article.bodyPending)}
            onTouchStart={() => prefetchArticle(article.id, article.atUri, article.bodyPending)}
            className="text-foreground decoration-accent decoration-2 underline-offset-4 transition-colors hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            {article.title}
            <PaywallBadge hasPaywall={!!article.paywall} unlocked={unlocked} />
          </Link>
        </h2>
        {article.subtitle && <p className="mt-1.5 text-[15px] text-muted-foreground">{article.subtitle}</p>}
        <p className="mt-3 max-w-[70ch] text-[15px] leading-relaxed">{plainExcerpt(article.excerpt)}</p>
        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
          <UpvoteButton articleId={article.id} />
          <BookmarkButton articleId={article.id} />
          <span className="text-sm font-medium">
            <Link
              to={`/profile/${article.author.handle}`}
              className="underline-offset-4 transition-colors hover:text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {article.author.name}
            </Link>
          </span>
          <span className="meta">@{article.author.handle}</span>
          {article.paywall && (
            <span className="meta inline-flex items-center gap-1 text-accent">
              {unlocked ? (
                <><LockOpen size={11} aria-hidden="true" /> Доступ открыт</>
              ) : (
                <><Lock size={11} aria-hidden="true" /> Платная</>
              )}
            </span>
          )}
          {article.kind === 'video' && (
            <span className="meta inline-flex items-center gap-1 text-accent">
              <Clapperboard size={11} aria-hidden="true" /> Видео
            </span>
          )}
          <span className="meta">{article.readingTime} мин</span>
          <span className="meta rounded-full border border-border px-2 py-0.5" title="Язык публикации">
            {languageName(article.language)}
          </span>
          <span className="meta">{article.comments.length} коммент.</span>
          {article.tags.map((t) => (
            <span key={t} className="meta !normal-case tracking-normal text-accent">
              #{t}
            </span>
          ))}
        </div>
      </article>
    </Reveal>
  )
}

const PAGE_SIZE = 10

/** 1 … 4 5 [6] 7 8 … 20 */
function pageNumbers(current: number, total: number): (number | null)[] {
  const out: (number | null)[] = []
  for (let n = 1; n <= total; n++) {
    if (n === 1 || n === total || Math.abs(n - current) <= 2) out.push(n)
    else if (out.at(-1) !== null) out.push(null)
  }
  return out
}

function pluralCollegia(n: number): string {
  const n10 = n % 10
  const n100 = n % 100
  if (n10 === 1 && n100 !== 11) return 'коллегии'
  if (n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14)) return 'коллегии'
  return 'коллегий'
}

export default function Feed() {
  const { articles, cases, caseStats, settings, prefs, setPrefs, unlocked, upvotes, bookmarks, authorSubscriptions } = useStore()
  const [hideGuilty, setHideGuilty] = useState(false)
  // фильтры и страница — в URL: ссылкой можно поделиться, «назад» работает
  const [params, setParams] = useSearchParams()
  const urlTags = params.get('tags')
  const feedTags = useMemo(() => (urlTags ? urlTags.split(',').filter(Boolean) : []), [urlTags])
  const lang = params.get('lang') ?? 'all'
  const kindParam = params.get('kind')
  const kind: 'all' | 'text' | 'video' = kindParam === 'text' || kindParam === 'video' ? kindParam : 'all'
  const page = Math.max(1, Number(params.get('page')) || 1)

  /** меняет параметры; любой новый фильтр возвращает на первую страницу */
  const setQuery = (patch: Record<string, string | null>, keepPage = false) =>
    setParams((prev) => {
      const next = new URLSearchParams(prev)
      for (const [k, v] of Object.entries(patch)) {
        if (v === null || v === '' || v === 'all') next.delete(k)
        else next.set(k, v)
      }
      if (!keepPage) next.delete('page')
      return next
    })
  const setTags = (tags: string[]) => {
    setQuery({ tags: tags.join(',') || null })
    setPrefs({ feedTags: tags })
  }
  const toggleTag = (t: string) => setTags(feedTags.includes(t) ? feedTags.filter((x) => x !== t) : [...feedTags, t])
  const setLang = (v: string) => setQuery({ lang: v })
  const setKind = (v: 'all' | 'text' | 'video') => setQuery({ kind: v })

  // открыли /feed без tags — подставляем сохранённые в настройках теги
  useEffect(() => {
    if (urlTags === null && prefs.feedTags.length > 0) {
      setParams((prev) => {
        const next = new URLSearchParams(prev)
        next.set('tags', prefs.feedTags.join(','))
        return next
      }, { replace: true })
    }
    // только при первом открытии
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const tagCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const a of articles) for (const t of a.tags) counts.set(t, (counts.get(t) ?? 0) + 1)
    return [...counts.entries()].sort((x, y) => y[1] - x[1])
  }, [articles])

  // языки — только те, что реально есть среди публикаций (включая custom из localStorage)
  const presentLangs = useMemo(() => {
    const present = new Set(articles.map((a) => a.language ?? 'ru'))
    const known = LANGUAGES.filter((l) => present.has(l.code))
    const knownCodes = new Set<string>(LANGUAGES.map((l) => l.code))
    const custom = [...present].filter((c) => !knownCodes.has(c)).sort()
    return [...known.map((l) => ({ code: l.code as string, name: l.name })), ...custom.map((c) => ({ code: c, name: c.toUpperCase() }))]
  }, [articles])

  // «Special for you»: частоты тегов в статьях, которые читатель поднял,
  // сохранил или чьих авторов читает; данных мало — честный fallback «Популярное»
  const tagReco = useMemo(() => {
    const interest = new Set<string>([...upvotes, ...bookmarks])
    const subbed = new Set(authorSubscriptions)
    for (const a of articles) if (subbed.has(a.author.handle)) interest.add(a.id)
    const freq = new Map<string, number>()
    for (const a of articles) {
      if (!interest.has(a.id)) continue
      for (const t of a.tags) freq.set(t, (freq.get(t) ?? 0) + 1)
    }
    const notSelected = (t: string) => !feedTags.includes(t)
    const personal = [...freq.entries()].sort((x, y) => y[1] - x[1]).map(([t]) => t).filter(notSelected)
    if (personal.length > 0) return { personal: true, tags: personal.slice(0, 4) }
    return { personal: false, tags: tagCounts.map(([t]) => t).filter(notSelected).slice(0, 4) }
  }, [articles, upvotes, bookmarks, authorSubscriptions, feedTags, tagCounts])

  // «Горячее» ранжирует сервер по всему индексу с теми же тегами и языком; null — ещё не ответил
  const hotKey = `${feedTags.join(',')}|${lang}|${kind}`
  const [serverHot, setServerHot] = useState<{ key: string; list: { article: Article; score: number }[] } | null>(null)
  const wantHot = prefs.feedSort === 'hot'
  useEffect(() => {
    if (!wantHot) return
    let alive = true
    fetchRanked({ sort: 'hot', limit: 100, tags: feedTags, ...(lang === 'all' ? {} : { lang }), ...(kind === 'all' ? {} : { kind }) }).then(
      (list) => alive && setServerHot({ key: hotKey, list }),
    )
    return () => {
      alive = false
    }
  }, [wantHot, hotKey, feedTags, lang, kind])

  const visible = useMemo(() => {
    const now = new Date().toISOString()
    const at = (a: (typeof articles)[number]) => Date.parse(a.publishedAtFull ?? a.publishedAt) || 0
    const passes = (a: Article) =>
      // отложенные публикации появляются в ленте только после publishAt
      (!a.publishAt || a.publishAt <= now) &&
      (!hideGuilty || a.verdict !== 'guilty') &&
      (prefs.showCondemned || a.verdict !== 'guilty') &&
      // ANY: достаточно одного выбранного тега
      (feedTags.length === 0 || a.tags.some((t) => feedTags.includes(t))) &&
      (lang === 'all' || (a.language ?? 'ru') === lang) &&
      (kind === 'all' || (a.kind ?? 'text') === kind)
    const list = articles.filter(passes)
    if (prefs.feedSort !== 'hot') return [...list].sort((x, y) => at(y) - at(x))
    // свои записи без индекса и ответ сервера — в один список по одному score (формула общая, см. hotness)
    // карточка из стора знает о моём лайке; статьи вне загруженных — карточка сервера, с теми же фильтрами
    const byId = new Map(articles.map((a) => [a.id, a]))
    const ranked =
      serverHot?.key === hotKey
        ? serverHot.list.map((r) => ({ a: byId.get(r.article.id) ?? r.article, score: r.score })).filter((r) => passes(r.a))
        : []
    if (!ranked.length) return [...list].sort((x, y) => hotness(y, upvotes.includes(y.id)) - hotness(x, upvotes.includes(x.id)))
    const inServer = new Set(ranked.map((r) => r.a.id))
    const own = list.filter((a) => !a.fromIndex && !inServer.has(a.id)).map((a) => ({ a, score: hotness(a, upvotes.includes(a.id)) }))
    return [...ranked, ...own].sort((x, y) => y.score - x.score).map((x) => x.a)
  }, [articles, hideGuilty, feedTags, lang, kind, prefs.showCondemned, prefs.feedSort, upvotes, serverHot, hotKey])
  const pages = Math.max(1, Math.ceil(visible.length / PAGE_SIZE))
  const current = Math.min(page, pages)
  const pageItems = visible.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE)
  const pageHref = (n: number) => {
    const next = new URLSearchParams(params)
    if (n === 1) next.delete('page')
    else next.set('page', String(n))
    const q = next.toString()
    return q ? `?${q}` : '/feed'
  }
  const openCases = cases.filter((c) => !caseStats(c).closed)
  const subscribedCount = Object.values(settings).filter((s) => s.subscribed).length

  const chip = (active: boolean) =>
    `cursor-pointer rounded-full border px-3 py-1 font-mono text-[12px] font-semibold tracking-[0.04em] transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
      active ? 'border-primary bg-primary text-primary-foreground' : 'border-border text-foreground hover:border-accent hover:text-accent'
    }`

  return (
    <div className="mx-auto max-w-[1200px] px-5 pb-24 md:px-8">
      {/* Шапка ленты */}
      <div className="flex flex-wrap items-end justify-between gap-4 pb-8 pt-10">
        <div>
          <p className="meta">Публикации читателей · AT Protocol</p>
          <h1 className="mt-2 text-4xl font-extrabold tracking-tight md:text-5xl">Лента</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label="Сортировка ленты" className="flex rounded-full border border-border bg-secondary/60 p-1">
          {(
            [
              { key: 'new', label: 'Свежее' },
              { key: 'hot', label: 'Горячее' },
            ] as const
          ).map((o) => (
            <button
              key={o.key}
              type="button"
              aria-pressed={prefs.feedSort === o.key}
              onClick={() => setPrefs({ feedSort: o.key })}
              className={`cursor-pointer rounded-full px-4 py-1.5 font-mono text-[12px] font-semibold uppercase tracking-[0.05em] transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                prefs.feedSort === o.key ? 'bg-primary text-primary-foreground' : 'text-foreground hover:text-accent'
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
        <div
          role="tablist"
          aria-label="Фильтр ленты"
          className="flex rounded-full border border-border bg-secondary/60 p-1"
        >
          {[
            { key: false, label: 'Все' },
            { key: true, label: 'Без осуждённых' },
          ].map((tab) => (
            <button
              key={String(tab.key)}
              role="tab"
              aria-selected={hideGuilty === tab.key}
              onClick={() => setHideGuilty(tab.key)}
              className={`cursor-pointer rounded-full px-4 py-1.5 font-mono text-[12px] font-semibold uppercase tracking-[0.05em] transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                hideGuilty === tab.key ? 'bg-primary text-primary-foreground' : 'text-foreground hover:text-accent'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
        </div>
      </div>

      <div className="grid gap-12 lg:grid-cols-[300px_minmax(0,1fr)]">
        {/* Левая колонка: фильтры, суд и модерация */}
        <aside className="space-y-10 lg:pt-2" aria-label="Фильтры, суд и модерация">
          <Reveal>
            <section className="rule pt-6">
              <h2 className="font-mono text-[13px] font-bold uppercase tracking-[0.12em]">Теги</h2>
              {/* Рекомендации тегов: персональные по активности, иначе честно «Популярное» */}
              {tagReco.tags.length > 0 && (
                <div className="mt-4">
                  <p className="meta mb-2 inline-flex items-center gap-1.5">
                    <Sparkles size={11} className="text-accent" aria-hidden="true" />
                    {tagReco.personal ? 'Special for you' : 'Популярное'}
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {tagReco.tags.map((t) => {
                      const isSelected = feedTags.includes(t)
                      return (
                        <button
                          key={t}
                          type="button"
                          onClick={() => toggleTag(t)}
                          aria-pressed={isSelected}
                          title={isSelected ? `Снять тег ${t}` : `Добавить тег ${t} к фильтру`}
                          className={`inline-flex cursor-pointer items-center gap-1 rounded-full border px-2.5 py-1 font-mono text-[12px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                            isSelected
                              ? 'border-primary bg-primary text-primary-foreground'
                              : 'border-border bg-background text-foreground hover:border-accent hover:text-accent'
                          }`}
                        >
                          {isSelected ? <X size={10} aria-hidden="true" /> : <Plus size={10} aria-hidden="true" />}
                          #{t}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}
              <div className="mt-4">
                <TagAutocomplete tags={tagCounts} selected={feedTags} onToggle={toggleTag} onClear={() => setTags([])} />
              </div>
              {feedTags.length > 1 && (
                <p className="meta mt-2 !normal-case tracking-normal text-muted-foreground">
                  показаны записи хотя бы с одним из тегов ({feedTags.length})
                </p>
              )}
            </section>
          </Reveal>

          <Reveal>
            <FeedBest articles={articles} upvoted={upvotes} />
          </Reveal>

          <Reveal>
            <section className="rule pt-6">
              <h2 className="font-mono text-[13px] font-bold uppercase tracking-[0.12em]">Тип контента</h2>
              <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label="Фильтр по типу контента">
                {(
                  [
                    { key: 'all', label: 'Все' },
                    { key: 'text', label: 'Текст' },
                    { key: 'video', label: 'Видео' },
                  ] as const
                ).map((opt) => (
                  <button
                    key={opt.key}
                    onClick={() => setKind(opt.key)}
                    aria-pressed={kind === opt.key}
                    className={chip(kind === opt.key)}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </section>
          </Reveal>

          <Reveal>
            <section className="rule pt-6">
              <h2 className="font-mono text-[13px] font-bold uppercase tracking-[0.12em]">Язык</h2>
              <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label="Фильтр по языку">
                {[{ key: 'all', label: 'Все языки' }, ...presentLangs.map((l) => ({ key: l.code, label: l.name }))].map((opt) => (
                  <button
                    key={opt.key}
                    onClick={() => setLang(opt.key)}
                    aria-pressed={lang === opt.key}
                    className={chip(lang === opt.key)}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </section>
          </Reveal>

          <Reveal>
            <section className="rule pt-6">
              <div className="flex items-center gap-2">
                <Gavel size={15} className="text-accent" aria-hidden="true" />
                <h2 className="font-mono text-[13px] font-bold uppercase tracking-[0.12em]">Суд присяжных</h2>
              </div>
              {openCases.length === 0 ? (
                <p className="mt-4 text-sm text-muted-foreground">Открытых дел нет. Лента чиста — пока.</p>
              ) : (
                <ul className="mt-4 space-y-4">
                  {openCases.map((c) => {
                    const s = caseStats(c)
                    return (
                      <li key={c.id}>
                        <Link
                          to={`/case/${c.id}`}
                          className="group block rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                        >
                          <span className="meta text-accent">{c.number}</span>
                          <span className="mt-1 block text-sm font-semibold leading-snug decoration-accent underline-offset-4 group-hover:underline">
                            {c.articleTitle}
                          </span>
                          <span className="meta mt-1.5 block">
                            Голосов {s.voted}/{c.jurorsTotal} · кворум {c.quorum}
                          </span>
                          <span className="mt-2 block h-1 overflow-hidden rounded-full bg-secondary">
                            <span
                              className="block h-full bg-accent transition-all duration-300"
                              style={{ width: `${(s.voted / c.jurorsTotal) * 100}%` }}
                            />
                          </span>
                        </Link>
                      </li>
                    )
                  })}
                </ul>
              )}
            </section>
          </Reveal>

          <Reveal>
            <section className="rule pt-6">
              <h2 className="font-mono text-[13px] font-bold uppercase tracking-[0.12em]">Ваши коллегии</h2>
              <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
                Вы доверяете вердиктам{' '}
                <Link to="/settings" className="font-semibold text-accent underline-offset-4 hover:underline">
                  {subscribedCount} {pluralCollegia(subscribedCount)}
                </Link>
                . Каждая метит контент подписанными метками — удалить статью не может никто.
              </p>
            </section>
          </Reveal>

          <Reveal>
            <section className="rule pt-6">
              <h2 className="font-mono text-[13px] font-bold uppercase tracking-[0.12em]">Принцип платформы</h2>
              <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
                Статьи живут в репозиториях авторов. Спорный контент рассматривает случайная коллегия из 7
                читателей, а вы сами решаете, как поступать с вердиктами: скрывать, предупреждать или
                игнорировать.
              </p>
              <Link
                to="/settings"
                className="mt-4 inline-flex items-center gap-1.5 font-mono text-[12px] font-semibold uppercase tracking-[0.08em] text-accent underline-offset-4 hover:underline"
              >
                Настроить <ArrowUpRight size={13} aria-hidden="true" />
              </Link>
            </section>
          </Reveal>
        </aside>

        {/* Список статей */}
        <section aria-label="Статьи">
          {visible.length === 0 ? (
            <p className="rule py-10 text-muted-foreground">По этому фильтру статей нет.</p>
          ) : (
            pageItems.map((a) => <ArticleRow key={a.id} article={a} unlocked={!!unlocked[a.id]} />)
          )}
          {pages > 1 && (
            <nav aria-label="Страницы ленты" className="rule mt-4 flex flex-wrap items-center gap-1.5 pt-6">
              {pageNumbers(current, pages).map((n, i) =>
                n === null ? (
                  <span key={`gap${i}`} className="px-1 text-muted-foreground">…</span>
                ) : (
                  <Link
                    key={n}
                    to={pageHref(n)}
                    onClick={() => window.scrollTo({ top: 0 })}
                    aria-current={n === current ? 'page' : undefined}
                    className={chip(n === current)}
                  >
                    {n}
                  </Link>
                ),
              )}
            </nav>
          )}
        </section>
      </div>
    </div>
  )
}
