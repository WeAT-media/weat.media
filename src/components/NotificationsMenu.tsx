import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { useNavigate } from 'react-router'
import { Bell, CheckCheck, LifeBuoy, MessageSquare, Newspaper, Reply, type LucideIcon } from 'lucide-react'
import { hasSession, myTickets, notifications as notificationsApi, type AppNotification, type MyTicket } from '@/lib/api'
import { useStore } from '@/lib/store'
import type { Article, Comment, User } from '@/types/types'
import { useI18n } from '@/lib/i18n'

interface Notification {
  id: string
  date: string
  icon: LucideIcon
  text: string
  to: string
  read: boolean
}

const shortTitle = (title: string) => title.length > 42 ? `${title.slice(0, 42)}…` : title

function localNotifications(
  articles: Article[],
  extraComments: Record<string, Comment[]>,
  user: User,
  subscriptions: string[],
  readIds: string[],
  prefs: { articles: boolean; comments: boolean; replies: boolean },
  t: ReturnType<typeof useI18n>['t'],
): Notification[] {
  const out: Notification[] = []
  for (const article of articles) {
    if (article.publishAt && article.publishAt > new Date().toISOString()) continue
    if (prefs.articles && subscriptions.includes(article.author.handle) && article.author.handle !== user.handle) {
      out.push({ id: `article-${article.id}`, date: article.publishedAt, icon: Newspaper, text: t('subscribedPost', article.title), to: `/article/${article.id}`, read: readIds.includes(`article-${article.id}`) })
    }
    const comments = [...article.comments, ...(extraComments[article.id] ?? [])]
    for (const comment of comments) {
      if (comment.author === user.handle) continue
      const parent = comment.parentId ? comments.find((c) => c.id === comment.parentId) : undefined
      const ownArticle = article.author.handle === user.handle
      const ownComment = parent?.author === user.handle
      if ((parent && ownComment && prefs.replies) || (!parent && ownArticle && prefs.comments)) {
        out.push({
          id: `comment-${article.id}-${comment.id}`,
          date: comment.at,
          icon: parent ? Reply : MessageSquare,
          text: parent
            ? t('repliedComment', comment.author, shortTitle(article.title))
            : t('commentedPost', comment.author, shortTitle(article.title)),
          to: `/article/${article.id}`,
          read: readIds.includes(`comment-${article.id}-${comment.id}`),
        })
      }
    }
  }
  return out.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 50)
}

export default function NotificationsMenu() {
  const { articles, extraComments, user, readNotifications, markNotificationsRead, authorSubscriptions, notificationPrefs } = useStore()
  const [open, setOpen] = useState(false)
  const [remote, setRemote] = useState<AppNotification[]>([])
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()
  const signedIn = !!user && hasSession()
  const { t } = useI18n()

  useEffect(() => {
    if (!signedIn) return
    let alive = true
    const load = () => notificationsApi.list().then(({ notifications }) => alive && setRemote(notifications), () => {})
    load()
    const timer = setInterval(load, 60_000)
    return () => { alive = false; clearInterval(timer) }
  }, [signedIn])

  const personal = useMemo<Notification[]>(() => {
    if (!user) return []
    const indexed = localNotifications(articles, extraComments, user, authorSubscriptions, readNotifications, notificationPrefs, t)
    if (!signedIn) return indexed
    const server = remote.map((n) => {
      const article = articles.find((a) => a.atUri === n.articleUri)
      const title = n.articleTitle || article?.title || t('post')
      const text = n.kind === 'article'
        ? t('subscribedPost', title)
        : n.kind === 'reply'
          ? t('repliedComment', n.actorHandle, shortTitle(title))
          : t('commentedPost', n.actorHandle, shortTitle(title))
      return { id: n.id, date: n.createdAt, icon: n.kind === 'article' ? Newspaper : n.kind === 'reply' ? Reply : MessageSquare, text, to: `/article/${article?.id ?? encodeURIComponent(n.articleUri)}`, read: !!n.readAt }
    })
    const known = new Set(server.map((n) => n.text))
    return [...server, ...indexed.filter((n) => !known.has(n.text))].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 50)
  }, [articles, extraComments, user, signedIn, remote, authorSubscriptions, readNotifications, notificationPrefs, t])

  const [tickets, setTickets] = useState<MyTicket[]>([])
  useEffect(() => {
    if (!signedIn) return
    let alive = true
    const load = () => myTickets.list().then((t) => alive && setTickets(t), () => {})
    load()
    const timer = setInterval(load, 60_000)
    return () => { alive = false; clearInterval(timer) }
  }, [signedIn])
  const support: Notification[] = (signedIn ? tickets : []).filter((ticket) => ticket.unread > 0).map((ticket) => {
    const last = [...ticket.messages].reverse().find((m) => m.author === 'staff')!
    return { id: `ticket-${last.id}`, date: last.createdAt, icon: LifeBuoy, text: t('supportReplied', ticket.subject), to: `/support/tickets#${ticket.id}`, read: false }
  })
  const notifications = [...support, ...personal]
  const unread = notifications.filter((n) => !n.read)

  useEffect(() => {
    if (!open) return
    panelRef.current?.focus()
    const onPointerDown = (e: PointerEvent) => { if (!rootRef.current?.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  const markRead = (ids: string[]) => {
    if (signedIn) {
      const remoteIds = ids.filter((id) => /^\d+$/.test(id))
      if (remoteIds.length) {
        setRemote((prev) => prev.map((n) => remoteIds.includes(n.id) ? { ...n, readAt: n.readAt ?? new Date().toISOString() } : n))
        void notificationsApi.markRead(remoteIds).catch(() => {})
      }
      markNotificationsRead(ids.filter((id) => !/^\d+$/.test(id)))
    } else markNotificationsRead(ids)
  }
  const openNotification = (n: Notification) => {
    markRead([n.id])
    setOpen(false)
    navigate(n.to)
  }
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      setOpen(false)
      triggerRef.current?.focus()
    }
  }

  const renderItem = (n: Notification) => (
    <li key={n.id} className="border-b border-border last:border-b-0">
      <button onClick={() => openNotification(n)} className={`flex w-full cursor-pointer items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-secondary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${n.read ? 'opacity-60' : ''}`}>
        <n.icon size={14} className="mt-0.5 shrink-0 text-accent" aria-hidden="true" />
        <span className="min-w-0">
          <span className="block text-[13px] leading-snug">{n.text}</span>
          <time className="meta mt-1 block" dateTime={n.date}>{n.date.slice(0, 10)}</time>
        </span>
        {!n.read && <span className="ml-auto mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" aria-label={t('unread')} />}
      </button>
    </li>
  )

  return (
    <div ref={rootRef} className="relative" onKeyDown={onKeyDown}>
      <button ref={triggerRef} onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-controls={open ? 'notifications-panel' : undefined} aria-haspopup="dialog" aria-label={unread.length ? t('unreadNotifications', unread.length) : t('notifications')} title={t('notifications')} className="relative flex h-9 w-9 cursor-pointer items-center justify-center rounded-full border border-border text-foreground transition-colors hover:border-accent hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <Bell size={14} aria-hidden="true" />
        {unread.length > 0 && <span aria-hidden="true" className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 font-mono text-[10px] font-bold text-accent-foreground">{unread.length}</span>}
      </button>
      {open && (
        <div id="notifications-panel" ref={panelRef} tabIndex={-1} role="dialog" aria-modal="false" aria-label={t('notifications')} className="absolute right-0 z-50 mt-2 w-80 max-w-[calc(100vw-2.5rem)] rounded-md border border-border bg-background shadow-lg focus:outline-none">
          <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2.5">
            <p className="meta">{t('notifications')}</p>
            {unread.length > 0 && <button onClick={() => signedIn ? (setRemote((prev) => prev.map((n) => ({ ...n, readAt: n.readAt ?? new Date().toISOString() }))), void notificationsApi.markAllRead().catch(() => {}), markNotificationsRead(notifications.map((n) => n.id))) : markRead(notifications.map((n) => n.id))} className="meta inline-flex cursor-pointer items-center gap-1 text-accent underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><CheckCheck size={12} aria-hidden="true" /> {t('markAllRead')}</button>}
          </div>
          {notifications.length === 0 ? <p className="px-4 py-6 text-sm text-muted-foreground">{t('notificationsEmpty')}</p> : (
            <ul className="max-h-80 overflow-y-auto">
              {support.length > 0 && <li className="meta border-b border-border bg-secondary/50 px-4 py-2">{t('support')}</li>}
              {support.map(renderItem)}
              {personal.length > 0 && <li className="meta border-b border-border bg-secondary/50 px-4 py-2">{t('forYou')}</li>}
              {personal.map(renderItem)}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
