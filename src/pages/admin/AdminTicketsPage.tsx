import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router'
import { FileText, Mail, ShieldCheck, User } from 'lucide-react'
import { SITE_NAME } from '@/config/site'
import { countryLabel } from '@/lib/api'
import { staffAuthConfigured, staffLogin, staffToken } from '@/lib/staffAuth'

/** Поддержка: обращения из /support/contact и запросы органов из /support/legal */

type Status = 'new' | 'in_progress' | 'waiting' | 'resolved' | 'rejected'

interface Ticket {
  id: string
  kind: 'support' | 'legal'
  category: string
  email: string
  did: string | null
  handle: string | null
  articleUrl: string | null
  subject: string
  message: string
  countryFrom: string | null
  countryTo: string | null
  docType: string | null
  docFile: { name: string; size: number; type: string } | null
  status: Status
  staffNote: string | null
  updatedBy: string | null
  createdAt: string
  updatedAt: string
  /** ответ дойдёт до заявителя на площадке: обращение из вошедшего аккаунта */
  deliverable: boolean
  messages: { id: string; author: 'staff' | 'user'; text: string; createdAt: string; staffSub: string | null }[]
}

const STATUS_LABEL: Record<Status, string> = {
  new: 'Новые',
  in_progress: 'В работе',
  waiting: 'Ждут ответа',
  resolved: 'Решены',
  rejected: 'Отклонены',
}
const STATUSES = Object.keys(STATUS_LABEL) as Status[]

const CATEGORY_LABEL: Record<string, string> = {
  'not-visible': 'Статья не видна',
  tech: 'Техническая проблема',
  money: 'Монетизация и выплаты',
  safety: 'Безопасность и жалобы',
  'country-change': 'Смена страны резидентства',
  other: 'Другое',
  'legal-request': 'Запрос органа',
  'staff-message': 'Сообщение от поддержки',
}
const DOC_LABEL: Record<string, string> = { passport: 'паспорт', registration: 'регистрация', 'residence-permit': 'вид на жительство', other: 'другой документ' }

const when = (iso: string) => new Date(iso).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

export default function AdminTicketsPage() {
  const token = staffToken()
  const [tab, setTab] = useState<Status | 'all'>('new')
  const [rows, setRows] = useState<Ticket[]>([])
  const [open, setOpen] = useState<string | null>(null)
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [replies, setReplies] = useState<Record<string, string>>({})
  const [error, setError] = useState('')

  const call = useCallback(
    async <T,>(path: string, init: RequestInit = {}): Promise<T> => {
      const res = await fetch(`/api${path}`, { ...init, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` } })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.message ?? `Ошибка ${res.status}`)
      return data as T
    },
    [token],
  )
  const load = useCallback(() => {
    call<Ticket[]>(`/admin/tickets${tab === 'all' ? '' : `?status=${tab}`}`).then(setRows, (e) => setError(e.message))
  }, [call, tab])
  useEffect(() => {
    if (token) load()
  }, [token, load])

  const update = async (id: string, body: { status?: Status; note?: string | null }) => {
    setError('')
    try {
      await call(`/admin/tickets/${id}`, { method: 'PATCH', body: JSON.stringify(body) })
      load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось')
    }
  }

  const reply = async (id: string) => {
    const text = (replies[id] ?? '').trim()
    if (!text) return
    setError('')
    try {
      await call(`/admin/tickets/${id}/messages`, { method: 'POST', body: JSON.stringify({ text }) })
      setReplies((r) => ({ ...r, [id]: '' }))
      load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось')
    }
  }

  if (!token) {
    return (
      <div className="mx-auto max-w-[520px] px-5 py-20">
        <h1 className="text-3xl font-extrabold tracking-tight">Обращения</h1>
        {staffAuthConfigured ? (
          <button type="button" onClick={() => void staffLogin('/admin/tickets')} className="btn-primary mt-6 w-full !py-2.5">
            <ShieldCheck size={15} aria-hidden="true" /> Войти через {SITE_NAME}
          </button>
        ) : (
          <p className="mt-4 text-sm text-muted-foreground">Вход сотрудников не настроен (VITE_ZITADEL_*).</p>
        )}
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-[1100px] px-5 pb-24 md:px-8">
      <div className="flex flex-wrap items-end justify-between gap-4 pt-10">
        <div>
          <p className="meta">Админка · поддержка</p>
          <h1 className="mt-2 text-4xl font-extrabold tracking-tight">Обращения</h1>
          <p className="mt-2 max-w-[66ch] text-sm text-muted-foreground">
            Поддержка и запросы органов. Документы к смене страны не загружаются — запросите файл у заявителя по email; страну
            резидентства меняйте после проверки.
          </p>
        </div>
        <div className="flex gap-2">
          <Link to="/admin/users" className="btn-ghost !px-3 !py-2 !text-[11px]">Пользователи</Link>
          <Link to="/admin/email" className="btn-ghost !px-3 !py-2 !text-[11px]">Почта</Link>
          <Link to="/admin/payouts" className="btn-ghost !px-3 !py-2 !text-[11px]">Выплаты</Link>
          <Link to="/admin/finance" className="btn-ghost !px-3 !py-2 !text-[11px]">Финансы</Link>
          <Link to="/admin/claims" className="btn-ghost !px-3 !py-2 !text-[11px]">Заявки на авторство</Link>
          <Link to="/admin/crawler" className="btn-ghost !px-3 !py-2 !text-[11px]">Краулер</Link>
        </div>
      </div>

      <div role="tablist" className="mt-6 flex flex-wrap gap-2">
        {(['all', ...STATUSES] as const).map((s) => (
          <button key={s} type="button" role="tab" aria-selected={tab === s} onClick={() => setTab(s)} className={`btn-ghost !px-3 !py-1.5 !text-[11px] ${tab === s ? '!border-accent !text-accent' : ''}`}>
            {s === 'all' ? 'Все' : STATUS_LABEL[s]}
          </button>
        ))}
      </div>
      {error && <p role="alert" className="mt-4 border border-destructive/60 bg-destructive/5 p-3 text-sm">{error}</p>}

      {rows.length === 0 ? (
        <p className="mt-8 text-muted-foreground">Обращений нет.</p>
      ) : (
        <ul className="mt-6 divide-y divide-border border border-border">
          {rows.map((t) => {
            const expanded = open === t.id
            return (
              <li key={t.id} className="p-5">
                <button type="button" onClick={() => setOpen(expanded ? null : t.id)} aria-expanded={expanded} className="flex w-full cursor-pointer flex-wrap items-baseline justify-between gap-2 text-left">
                  <span className="min-w-0">
                    <span className="font-bold">{t.subject}</span>
                    <span className="meta ml-2">
                      {t.kind === 'legal' ? 'запрос органа · ' : ''}
                      {CATEGORY_LABEL[t.category] ?? t.category}
                    </span>
                  </span>
                  <span className="meta shrink-0">
                    {t.id} · {when(t.createdAt)} · <span className={t.status === 'new' ? 'text-accent' : ''}>{STATUS_LABEL[t.status]}</span>
                  </span>
                </button>

                {expanded && (
                  <div className="mt-4 grid gap-4 md:grid-cols-[1fr_280px]">
                    <div className="min-w-0 space-y-3 text-sm">
                      <p className="flex flex-wrap gap-x-4 gap-y-1">
                        <span className="inline-flex items-center gap-1"><Mail size={12} aria-hidden="true" /> <a href={`mailto:${t.email}`} className="text-accent hover:underline">{t.email}</a></span>
                        <span className="inline-flex items-center gap-1">
                          <User size={12} aria-hidden="true" /> {t.did ? <code className="font-mono text-[12px]">{t.did}</code> : 'гость'}
                          {t.handle && ` · указал: ${t.handle}`}
                          {t.handle && !t.did && <span className="ml-1 rounded-full border border-border px-1.5 text-[11px] text-muted-foreground">не подтверждён</span>}
                        </span>
                      </p>
                      {t.articleUrl && <p>Ссылка: <a href={t.articleUrl} target="_blank" rel="noopener noreferrer" className="break-all text-accent hover:underline">{t.articleUrl}</a></p>}
                      {(t.countryFrom || t.countryTo) && (
                        <p>
                          Резидентство: {t.countryFrom ? countryLabel(t.countryFrom) : '—'} → <b>{t.countryTo ? countryLabel(t.countryTo) : '—'}</b>
                        </p>
                      )}
                      {t.docType && (
                        <p className="inline-flex items-center gap-1">
                          <FileText size={12} aria-hidden="true" /> {DOC_LABEL[t.docType] ?? t.docType}
                          {t.docFile && ` · ${t.docFile.name}, ${Math.round(t.docFile.size / 1024)} КБ — файл не загружен, запросите у заявителя`}
                        </p>
                      )}
                      <p className="whitespace-pre-line rounded-md border border-border bg-secondary/40 p-3 leading-relaxed">{t.message}</p>
                      {t.messages.map((m) => (
                        <div key={m.id} className={`rounded-md border p-3 ${m.author === 'staff' ? 'ml-8 border-accent/50' : 'border-border'}`}>
                          <p className="meta mb-1">{m.author === 'staff' ? `Поддержка · ${m.staffSub ?? ''}` : 'Заявитель'} · {when(m.createdAt)}</p>
                          <p className="whitespace-pre-line leading-relaxed">{m.text}</p>
                        </div>
                      ))}
                      <div className="grid gap-2">
                        <textarea
                          rows={3}
                          value={replies[t.id] ?? ''}
                          onChange={(e) => setReplies((r) => ({ ...r, [t.id]: e.target.value }))}
                          placeholder="Ответ заявителю"
                          aria-label="Ответ заявителю"
                          className="rounded-md border border-input bg-background px-3 py-2 text-sm"
                        />
                        <div className="flex flex-wrap items-center gap-3">
                          <button type="button" onClick={() => void reply(t.id)} disabled={!(replies[t.id] ?? '').trim()} className="btn-primary !px-4 !py-2">
                            Ответить
                          </button>
                          <span className="meta !normal-case tracking-normal">
                            {t.deliverable
                              ? 'заявитель увидит ответ на площадке и в уведомлениях'
                              : `писал без входа — на площадку ответ не уйдёт; ответьте на ${t.email}`}
                          </span>
                        </div>
                      </div>
                      {t.updatedBy && <p className="meta">изменено {when(t.updatedAt)} · {t.updatedBy}</p>}
                    </div>
                    <div className="grid content-start gap-2">
                      <label className="grid gap-1 text-sm font-semibold">Статус
                        <select value={t.status} onChange={(e) => void update(t.id, { status: e.target.value as Status })} className="rounded-md border border-input bg-background px-3 py-2 text-sm">
                          {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                        </select>
                      </label>
                      <label className="grid gap-1 text-sm font-semibold">Заметка сотрудника
                        <textarea
                          rows={4}
                          value={notes[t.id] ?? t.staffNote ?? ''}
                          onChange={(e) => setNotes((n) => ({ ...n, [t.id]: e.target.value }))}
                          className="rounded-md border border-input bg-background px-3 py-2 text-sm font-normal"
                          placeholder="видна только сотрудникам"
                        />
                      </label>
                      <button type="button" onClick={() => void update(t.id, { note: (notes[t.id] ?? '').trim() || null })} className="btn-ghost !px-3 !py-1.5 !text-[11px]">
                        Сохранить заметку
                      </button>
                    </div>
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
