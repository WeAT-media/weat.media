import { useMemo } from 'react'
import { Link } from 'react-router'
import { Gavel, MessageSquare, Newspaper, type LucideIcon } from 'lucide-react'
import { useStore } from '@/lib/store'

interface TickerEvent {
  key: string
  date: string
  icon: LucideIcon
  text: string
  to: string
}

const MAX_EVENTS = 12

/** Шаблоны бегущей строки: RU/EN; заголовки статей и @handle остаются оригинальными */
const t9n = {
  ru: {
    ariaLabel: 'Последние события',
    newArticle: (title: string) => `Новая запись: ${title}`,
    comment: (author: string, title: string) => `@${author} к «${title}»`,
    fallbackPost: 'записи',
    verdict: (number: string, outcome: string) => `${number}: вердикт — ${outcome === 'guilty' ? 'виновна' : 'невиновна'}`,
  },
  en: {
    ariaLabel: 'Latest activity',
    newArticle: (title: string) => `New post: ${title}`,
    comment: (author: string, title: string) => `@${author} on "${title}"`,
    fallbackPost: 'a post',
    verdict: (number: string, outcome: string) => `${number}: verdict — ${outcome === 'guilty' ? 'guilty' : 'not guilty'}`,
  },
} as const

function TickerList({ events, hidden }: { events: TickerEvent[]; hidden?: boolean }) {
  return (
    <ul className="flex shrink-0 items-center" aria-hidden={hidden || undefined}>
      {events.map((ev) => (
        <li key={ev.key} className="flex shrink-0 items-center">
          <Link
            to={ev.to}
            tabIndex={hidden ? -1 : undefined}
            className="meta inline-flex items-center gap-1.5 whitespace-nowrap px-5 py-2 !normal-case tracking-[0.04em] transition-colors hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ev.icon size={12} className="shrink-0 text-accent" aria-hidden="true" />
            {ev.text}
            <span>· {ev.date}</span>
          </Link>
          <span className="h-1 w-1 shrink-0 rounded-full bg-border" aria-hidden="true" />
        </li>
      ))}
    </ul>
  )
}

/** Бегущая строка последних событий: статьи, комментарии, вердикты судов */
export default function EventTicker() {
  const { articles, cases, extraComments, prefs } = useStore()
  // system следует языку интерфейса
  const lang = prefs.tickerLang === 'system' ? prefs.uiLang : prefs.tickerLang
  // старые сохранённые настройки без tickerLang/uiLang -> русский
  const t = t9n[lang] ?? t9n.ru

  const events = useMemo<TickerEvent[]>(() => {
    const now = new Date().toISOString()
    const list: TickerEvent[] = []
    for (const a of articles) {
      if (a.publishAt && a.publishAt > now) continue
      list.push({
        key: `article-${a.id}`,
        date: a.publishedAt,
        icon: Newspaper,
        text: t.newArticle(a.title),
        to: `/article/${a.id}`,
      })
      for (const c of a.comments) {
        list.push({
          key: `comment-${a.id}-${c.id}`,
          date: c.at.slice(0, 10),
          icon: MessageSquare,
          text: t.comment(c.author, a.title.length > 48 ? `${a.title.slice(0, 48)}…` : a.title),
          to: `/article/${a.id}`,
        })
      }
    }
    for (const [articleId, comments] of Object.entries(extraComments)) {
      const a = articles.find((x) => x.id === articleId)
      for (const c of comments) {
        list.push({
          key: `comment-${articleId}-${c.id}`,
          date: c.at.slice(0, 10),
          icon: MessageSquare,
          text: t.comment(c.author, a ? (a.title.length > 48 ? `${a.title.slice(0, 48)}…` : a.title) : t.fallbackPost),
          to: `/article/${articleId}`,
        })
      }
    }
    for (const c of cases) {
      if (c.status === 'closed' && c.outcome) {
        list.push({
          key: `case-${c.id}`,
          date: c.openedAt,
          icon: Gavel,
          text: t.verdict(c.number, c.outcome),
          to: `/case/${c.id}`,
        })
      }
    }
    return list.sort((x, y) => y.date.localeCompare(x.date)).slice(0, MAX_EVENTS)
  }, [articles, cases, extraComments, t])

  if (prefs.hideTicker) return null

  return (
    <section aria-label={t.ariaLabel} className="ticker h-[37px] border-b border-border bg-secondary/60">
      {events.length > 0 && <div className="ticker-track">
        <TickerList events={events} />
        <TickerList events={events} hidden />
      </div>}
    </section>
  )
}
