import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { Link, useNavigate } from 'react-router'
import { Bell, CheckCheck, Gavel, LifeBuoy, MessageSquare, Newspaper, type LucideIcon } from 'lucide-react'
import { hasSession, myTickets, type MyTicket } from '@/lib/api'
import { useStore } from '@/lib/store'
import type { User } from '@/types/types'

interface Notification {
  id: string
  date: string
  icon: LucideIcon
  text: string
  to: string
}

const MAX_NOTIFICATIONS = 8

function buildNotifications(
  articles: ReturnType<typeof useStore>['articles'],
  cases: ReturnType<typeof useStore>['cases'],
  user: User | null,
  authorSubscriptions: string[],
  watchedArticles: string[],
): { personal: Notification[]; general: Notification[] } {
  const personal: Notification[] = []
  const general: Notification[] = []
  const personalIds = new Set<string>()

  for (const c of cases) {
    if (c.status === 'closed' && c.outcome) {
      general.push({
        id: `case-${c.id}`,
        date: c.openedAt,
        icon: Gavel,
        text: `${c.number}: статья «${c.articleTitle}» ${c.outcome === 'guilty' ? 'осуждена' : 'оправдана'}`,
        to: `/case/${c.id}`,
      })
    }
  }
  for (const a of articles) {
    if (a.publishAt && a.publishAt > new Date().toISOString()) continue
    const subscribed = authorSubscriptions.includes(a.author.handle)
    const item: Notification = {
      id: `article-${a.id}`,
      date: a.publishedAt,
      icon: Newspaper,
      text: subscribed ? `Новая запись по подписке: ${a.title}` : `Новая запись: ${a.title}`,
      to: `/article/${a.id}`,
    }
    if (subscribed) {
      personal.push(item)
      personalIds.add(item.id)
    } else {
      general.push(item)
    }
    for (const c of a.comments) {
      const own = user && a.author.handle === user.handle
      const watched = watchedArticles.includes(a.id)
      const text = own
        ? `@${c.author} прокомментировал вашу запись «${a.title.length > 42 ? `${a.title.slice(0, 42)}…` : a.title}»`
        : watched
          ? `@${c.author} ответил в треде, за которым вы следите: «${a.title.length > 42 ? `${a.title.slice(0, 42)}…` : a.title}»`
          : `@${c.author} прокомментировал «${a.title.length > 42 ? `${a.title.slice(0, 42)}…` : a.title}»`
      const item2: Notification = {
        id: `comment-${a.id}-${c.id}`,
        date: c.at,
        icon: MessageSquare,
        text,
        to: `/article/${a.id}`,
      }
      if (own || watched) {
        personal.push(item2)
        personalIds.add(item2.id)
      } else {
        general.push(item2)
      }
    }
  }
  const byDate = (x: Notification, y: Notification) => y.date.localeCompare(x.date)
  return {
    personal: personal.sort(byDate).slice(0, 6),
    general: general.filter((n) => !personalIds.has(n.id)).sort(byDate).slice(0, MAX_NOTIFICATIONS),
  }
}

/** Колокольчик с уведомлениями: вердикты судов, новые статьи и комментарии */
export default function NotificationsMenu() {
  const { articles, cases, user, readNotifications, markNotificationsRead, authorSubscriptions, watchedArticles } = useStore()
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()

  const { personal, general } = useMemo(
    () => buildNotifications(articles, cases, user, authorSubscriptions, watchedArticles),
    [articles, cases, user, authorSubscriptions, watchedArticles],
  )
  // ответы поддержки — только по обращениям из аккаунта (handle гостя не подтверждён)
  const [tickets, setTickets] = useState<MyTicket[]>([])
  const signedIn = !!user && hasSession()
  useEffect(() => {
    if (!signedIn) return
    let alive = true
    const load = () => myTickets.list().then((t) => alive && setTickets(t), () => {})
    load()
    const timer = setInterval(load, 60_000)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [signedIn])
  const support: Notification[] = (signedIn ? tickets : [])
    .filter((t) => t.unread > 0)
    .map((t) => {
      const last = [...t.messages].reverse().find((m) => m.author === 'staff')!
      return { id: `ticket-${last.id}`, date: last.createdAt.slice(0, 10), icon: LifeBuoy, text: `Поддержка ответила: «${t.subject}»`, to: `/support/tickets#${t.id}` }
    })
  const notifications = [...support, ...personal, ...general]
  const unread = notifications.filter((n) => !readNotifications.includes(n.id))

  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') setOpen(false)
  }

  const openNotification = (n: Notification) => {
    markNotificationsRead([n.id])
    setOpen(false)
    navigate(n.to)
  }

  const renderItem = (n: Notification) => {
    const isUnread = !readNotifications.includes(n.id)
    return (
      <li key={n.id} className="border-b border-border last:border-b-0">
        <button
          onClick={() => openNotification(n)}
          className={`flex w-full cursor-pointer items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-secondary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${
            isUnread ? '' : 'opacity-60'
          }`}
        >
          <n.icon size={14} className="mt-0.5 shrink-0 text-accent" aria-hidden="true" />
          <span className="min-w-0">
            <span className="block text-[13px] leading-snug">{n.text}</span>
            <span className="meta mt-1 block">{n.date}</span>
          </span>
          {isUnread && (
            <span className="ml-auto mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" aria-label="Непрочитано" />
          )}
        </button>
      </li>
    )
  }

  return (
    <div ref={rootRef} className="relative" onKeyDown={onKeyDown}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={unread.length > 0 ? `Уведомления, непрочитанных: ${unread.length}` : 'Уведомления'}
        title="Уведомления"
        className="relative flex h-9 w-9 cursor-pointer items-center justify-center rounded-full border border-border text-foreground transition-colors hover:border-accent hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Bell size={14} aria-hidden="true" />
        {unread.length > 0 && (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 font-mono text-[10px] font-bold text-accent-foreground">
            {unread.length}
          </span>
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Уведомления"
          className="absolute right-0 z-50 mt-2 w-80 max-w-[calc(100vw-2.5rem)] rounded-md border border-border bg-background shadow-lg"
        >
          <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2.5">
            <p className="meta">Уведомления</p>
            {unread.length > 0 && (
              <button
                onClick={() => markNotificationsRead(notifications.map((n) => n.id))}
                className="meta inline-flex cursor-pointer items-center gap-1 text-accent underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <CheckCheck size={12} aria-hidden="true" /> Прочитать все
              </button>
            )}
          </div>

          {notifications.length === 0 ? (
            <p className="px-4 py-6 text-sm text-muted-foreground">
              Пока пусто: вердикты судов и новые комментарии появятся здесь.
            </p>
          ) : (
            <ul className="max-h-80 overflow-y-auto">
              {support.length > 0 && (
                <li className="meta border-b border-border bg-secondary/50 px-4 py-2" aria-hidden="true">
                  Поддержка
                </li>
              )}
              {support.map((n) => renderItem(n))}
              {personal.length > 0 && (
                <li className="meta border-b border-border bg-secondary/50 px-4 py-2" aria-hidden="true">
                  Для вас
                </li>
              )}
              {personal.map((n) => renderItem(n))}
              {personal.length > 0 && general.length > 0 && (
                <li className="meta border-b border-border bg-secondary/50 px-4 py-2" aria-hidden="true">
                  Все события
                </li>
              )}
              {general.map((n) => renderItem(n))}
            </ul>
          )}

          {!user && (
            <p className="border-t border-border px-4 py-2.5">
              <Link
                to="/login"
                onClick={() => setOpen(false)}
                className="meta text-accent underline-offset-4 hover:underline"
              >
                Войдите
              </Link>{' '}
              <span className="meta">— будем персонализировать под ваши записи</span>
            </p>
          )}
        </div>
      )}
    </div>
  )
}
