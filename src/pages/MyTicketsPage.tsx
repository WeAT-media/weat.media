import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router'
import { ArrowLeft, Lock } from 'lucide-react'
import { useStore } from '@/lib/store'
import { hasSession, myTickets, type MyTicket } from '@/lib/api'

const STATUS_LABEL: Record<MyTicket['status'], string> = {
  new: 'принято',
  in_progress: 'в работе',
  waiting: 'ждём вашего ответа',
  resolved: 'решено',
  rejected: 'отклонено',
}
const when = (iso: string) => new Date(iso).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

/**
 * Мои обращения: переписка с поддержкой. Здесь — только обращения, отправленные из этого аккаунта:
 * handle, вписанный в форму без входа, не подтверждён, и ответы на него сюда не приходят.
 */
export default function MyTicketsPage() {
  const { user } = useStore()
  const location = useLocation()
  const [tickets, setTickets] = useState<MyTicket[] | null>(null)
  const [open, setOpen] = useState<string | null>(location.hash.slice(1) || null)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [error, setError] = useState('')
  const signedIn = !!user && hasSession()

  useEffect(() => {
    if (!signedIn) return
    let alive = true
    myTickets.list().then((t) => alive && setTickets(t), (e) => alive && setError(e instanceof Error ? e.message : 'Не удалось загрузить'))
    return () => {
      alive = false
    }
  }, [signedIn])

  // открыл обращение с новыми ответами — отмечаем прочитанными (на сервере и в списке)
  useEffect(() => {
    const t = tickets?.find((x) => x.id === open)
    if (!t || t.unread === 0) return
    myTickets.seen(t.id).then(
      () => setTickets((list) => list?.map((x) => (x.id === t.id ? { ...x, unread: 0 } : x)) ?? list),
      () => {},
    )
  }, [open, tickets])

  const reply = async (id: string) => {
    const text = (drafts[id] ?? '').trim()
    if (!text) return
    setError('')
    try {
      const updated = await myTickets.reply(id, text)
      setTickets((list) => list?.map((x) => (x.id === id ? updated : x)) ?? list)
      setDrafts((d) => ({ ...d, [id]: '' }))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось отправить')
    }
  }

  if (!signedIn) {
    return (
      <div className="mx-auto max-w-[720px] px-5 py-24 text-center">
        <Lock size={22} className="mx-auto text-accent" aria-hidden="true" />
        <h1 className="mt-4 text-3xl font-extrabold tracking-tight">Мои обращения</h1>
        <p className="mx-auto mt-3 max-w-[48ch] text-muted-foreground">
          Переписка с поддержкой привязана к аккаунту. Войдите — покажем ваши обращения и ответы.
        </p>
        <Link to="/login?returnTo=/support/tickets" className="btn-primary mt-8">Войти</Link>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-[860px] px-5 pb-24 md:px-8">
      <div className="pt-10">
        <Link to="/support" className="inline-flex items-center gap-2 font-mono text-[12px] font-semibold uppercase tracking-[0.08em] text-muted-foreground transition-colors hover:text-accent">
          <ArrowLeft size={13} aria-hidden="true" /> Поддержка
        </Link>
        <h1 className="mt-6 text-4xl font-extrabold tracking-tight">Мои обращения</h1>
        <p className="mt-3 max-w-[64ch] text-sm text-muted-foreground">
          Обращения, отправленные из этого аккаунта. Ответ поддержки приходит сюда и в уведомления. Если писали без входа —
          ответ придёт только на email.
        </p>
      </div>
      {error && <p role="alert" className="mt-4 text-sm text-destructive">{error}</p>}

      {tickets === null ? (
        <p className="meta mt-8">Загружаем…</p>
      ) : tickets.length === 0 ? (
        <p className="rule mt-8 py-8 text-sm text-muted-foreground">
          Обращений пока нет. <Link to="/support/contact" className="text-accent hover:underline">Написать в поддержку</Link>
        </p>
      ) : (
        <ul className="mt-8">
          {tickets.map((t) => {
            const expanded = open === t.id
            return (
              <li key={t.id} id={t.id} className="rule scroll-mt-28 py-5">
                <button type="button" onClick={() => setOpen(expanded ? null : t.id)} aria-expanded={expanded} className="flex w-full cursor-pointer flex-wrap items-baseline justify-between gap-2 text-left">
                  <span className="font-semibold">
                    {t.subject}
                    {t.unread > 0 && <span className="ml-2 rounded-full bg-accent px-2 py-0.5 font-mono text-[10px] text-accent-foreground">новых: {t.unread}</span>}
                  </span>
                  <span className="meta">{t.id} · {when(t.createdAt)} · {STATUS_LABEL[t.status]}</span>
                </button>
                {expanded && (
                  <div className="mt-4 space-y-3">
                    <p className="whitespace-pre-line rounded-md border border-border bg-secondary/40 p-3 text-sm leading-relaxed">{t.message}</p>
                    {t.messages.map((m) => (
                      <div key={m.id} className={`rounded-md border p-3 text-sm ${m.author === 'staff' ? 'border-accent/50' : 'ml-8 border-border'}`}>
                        <p className="meta mb-1">{m.author === 'staff' ? 'Поддержка' : 'Вы'} · {when(m.createdAt)}</p>
                        <p className="whitespace-pre-line leading-relaxed">{m.text}</p>
                      </div>
                    ))}
                    {t.status !== 'rejected' && (
                      <div className="grid gap-2">
                        <label htmlFor={`reply-${t.id}`} className="sr-only">Ваш ответ</label>
                        <textarea
                          id={`reply-${t.id}`}
                          rows={3}
                          value={drafts[t.id] ?? ''}
                          onChange={(e) => setDrafts((d) => ({ ...d, [t.id]: e.target.value }))}
                          placeholder="Ваш ответ поддержке"
                          className="rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        />
                        <button type="button" onClick={() => void reply(t.id)} disabled={!(drafts[t.id] ?? '').trim()} className="btn-primary w-fit !px-4 !py-2">
                          Ответить
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
