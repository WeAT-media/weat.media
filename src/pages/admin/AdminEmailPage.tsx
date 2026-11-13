import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router'
import { Paperclip, Reply, Send, ShieldCheck } from 'lucide-react'
import { SITE_NAME } from '@/config/site'
import { staffAuthConfigured, staffLogin, staffToken } from '@/lib/staffAuth'

/**
 * Почта площадки: support@ (поддержка и админы), legal@ и noreply@ (только админы).
 * Письма — только текстом: HTML чужих писем на нашем домене не показываем. Открытие и ответ — в журнале сотрудников.
 */

type Box = 'support' | 'legal' | 'noreply'

interface Summary {
  uid: number
  from: string
  to: string
  subject: string
  date: string
  seen: boolean
  hasAttachments: boolean
}

interface Message extends Summary {
  messageId: string | null
  replyTo: string | null
  text: string
  attachments: { id: string; filename: string; contentType: string; size: number }[]
}

const BOX_LABEL: Record<Box, string> = { support: 'support@', legal: 'legal@', noreply: 'noreply@ · отказы доставки' }

const when = (iso: string) => new Date(iso).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
/** первый адрес из «Имя <a@b>, …» */
const firstAddress = (s: string | null | undefined) => s?.match(/<([^>]+)>/)?.[1] ?? s?.split(',')[0]?.trim() ?? ''
const kb = (n: number) => (n < 1024 ? `${n} Б` : n < 1024 * 1024 ? `${Math.round(n / 1024)} КБ` : `${(n / 1024 / 1024).toFixed(1)} МБ`)

export default function AdminEmailPage() {
  const token = staffToken()
  const [boxes, setBoxes] = useState<Box[] | null>(null)
  const [box, setBox] = useState<Box>('support')
  const [list, setList] = useState<Summary[]>([])
  const [next, setNext] = useState<number | null>(null)
  const [message, setMessage] = useState<Message | null>(null)
  const [draft, setDraft] = useState<{ to: string; subject: string; text: string; replyToUid?: number } | null>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
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

  const load = useCallback(
    (b: Box, before?: number) =>
      call<{ messages: Summary[]; nextBeforeUid: number | null }>(`/admin/mail/${b}/messages${before ? `?before=${before}` : ''}`).then(
        (r) => {
          setList((prev) => (before ? [...prev, ...r.messages] : r.messages))
          setNext(r.nextBeforeUid)
        },
        (e: Error) => setError(e.message),
      ),
    [call],
  )

  useEffect(() => {
    if (!token) return
    call<{ boxes: Box[] }>('/admin/mail/boxes').then(
      (r) => {
        setBoxes(r.boxes)
        if (r.boxes[0]) setBox(r.boxes[0])
      },
      (e: Error) => setError(e.message),
    )
  }, [token, call])

  useEffect(() => {
    if (boxes?.includes(box)) void load(box)
  }, [box, boxes, load])

  const chooseBox = (b: Box) => {
    setMessage(null)
    setDraft(null)
    setError('')
    setBox(b)
  }

  const open = async (uid: number) => {
    setError('')
    setDraft(null)
    try {
      const m = await call<Message>(`/admin/mail/${box}/messages/${uid}`)
      setMessage(m)
      setList((prev) => prev.map((x) => (x.uid === uid ? { ...x, seen: true } : x)))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось открыть письмо')
    }
  }

  /** вложение — через fetch с токеном: прямой ссылкой его не открыть */
  const download = async (m: Message, a: Message['attachments'][number]) => {
    const res = await fetch(`/api/admin/mail/${box}/messages/${m.uid}/attachments/${a.id}`, { headers: { authorization: `Bearer ${token}` } })
    if (!res.ok) return setError('Не удалось скачать вложение')
    const url = URL.createObjectURL(await res.blob())
    const link = Object.assign(document.createElement('a'), { href: url, download: a.filename })
    link.click()
    URL.revokeObjectURL(url)
  }

  const send = async () => {
    if (!draft) return
    setBusy(true)
    setError('')
    try {
      await call(`/admin/mail/${box}/send`, { method: 'POST', body: JSON.stringify(draft) })
      setNotice(`Отправлено: ${draft.to}`)
      setDraft(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось отправить')
    } finally {
      setBusy(false)
    }
  }

  if (!token) {
    return (
      <div className="mx-auto max-w-[520px] px-5 py-20">
        <h1 className="text-3xl font-extrabold tracking-tight">Почта</h1>
        {staffAuthConfigured ? (
          <button type="button" onClick={() => void staffLogin('/admin/email')} className="btn-primary mt-6 w-full !py-2.5">
            <ShieldCheck size={15} aria-hidden="true" /> Войти через {SITE_NAME}
          </button>
        ) : (
          <p className="mt-4 text-sm text-muted-foreground">Вход сотрудников не настроен (VITE_ZITADEL_*).</p>
        )}
      </div>
    )
  }

  const field = 'w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

  return (
    <div className="mx-auto max-w-[1100px] px-5 pb-24 md:px-8">
      <div className="flex flex-wrap items-end justify-between gap-4 pt-10">
        <div>
          <p className="meta">Админка · почта</p>
          <h1 className="mt-2 text-4xl font-extrabold tracking-tight">Почта</h1>
          <p className="mt-2 max-w-[66ch] text-sm text-muted-foreground">
            Письма показываются текстом, вложения — только скачиванием. Каждое открытие и ответ попадают в журнал сотрудников.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link to="/admin/tickets" className="btn-ghost !px-3 !py-2 !text-[11px]">Обращения</Link>
          <Link to="/admin/users" className="btn-ghost !px-3 !py-2 !text-[11px]">Пользователи</Link>
        </div>
      </div>

      {boxes && boxes.length === 0 && <p className="mt-6 text-sm text-muted-foreground">Нет доступных ящиков: нужна роль support или admin, а у AppView — пароли ящиков.</p>}

      {boxes && boxes.length > 0 && (
        <>
          <div role="tablist" className="mt-6 flex flex-wrap items-center gap-2">
            {boxes.map((b) => (
              <button
                key={b}
                type="button"
                role="tab"
                aria-selected={box === b}
                onClick={() => chooseBox(b)}
                className={`rounded-md border px-3 py-1.5 font-mono text-[11px] font-semibold uppercase tracking-[0.08em] ${box === b ? 'border-accent text-accent' : 'border-border text-muted-foreground hover:text-foreground'}`}
              >
                {BOX_LABEL[b]}
              </button>
            ))}
            {box !== 'noreply' && (
              <button
                type="button"
                onClick={() => {
                  setMessage(null)
                  setDraft({ to: '', subject: '', text: '' })
                }}
                className="btn-primary ml-auto !px-3 !py-1.5 !text-[11px]"
              >
                <Send size={13} aria-hidden="true" /> Новое письмо
              </button>
            )}
          </div>

          {notice && <p className="mt-4 text-sm">{notice}</p>}
          {error && <p role="alert" className="mt-4 text-sm text-destructive">{error}</p>}

          <div className="mt-4 grid gap-6 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
            <ul className="border border-border">
              {list.length === 0 && <li className="p-4 text-sm text-muted-foreground">Писем нет.</li>}
              {list.map((m) => (
                <li key={m.uid} className="border-b border-border/70 last:border-b-0">
                  <button
                    type="button"
                    onClick={() => void open(m.uid)}
                    className={`block w-full px-4 py-3 text-left hover:bg-secondary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${message?.uid === m.uid ? 'bg-secondary/60' : ''}`}
                  >
                    <span className="flex items-baseline justify-between gap-3">
                      <span className={`truncate text-sm ${m.seen ? '' : 'font-bold'}`}>{m.from || '(без отправителя)'}</span>
                      <span className="meta shrink-0">{when(m.date)}</span>
                    </span>
                    <span className="mt-0.5 flex items-center gap-1.5 truncate text-sm text-muted-foreground">
                      {m.hasAttachments && <Paperclip size={12} aria-label="есть вложения" />}
                      {m.subject || '(без темы)'}
                    </span>
                  </button>
                </li>
              ))}
              {next && (
                <li className="p-3">
                  <button type="button" onClick={() => void load(box, next)} className="btn-ghost w-full !py-1.5 !text-[11px]">
                    Ещё
                  </button>
                </li>
              )}
            </ul>

            <div>
              {draft ? (
                <form
                  onSubmit={(e) => {
                    e.preventDefault()
                    void send()
                  }}
                  className="space-y-3 border border-border p-4"
                >
                  <p className="meta">от {box}@weat.media</p>
                  <input required type="email" value={draft.to} onChange={(e) => setDraft({ ...draft, to: e.target.value })} placeholder="кому" aria-label="Кому" className={field} />
                  <input required value={draft.subject} onChange={(e) => setDraft({ ...draft, subject: e.target.value })} placeholder="тема" aria-label="Тема" className={field} />
                  <textarea required rows={12} value={draft.text} onChange={(e) => setDraft({ ...draft, text: e.target.value })} aria-label="Текст письма" className={field} />
                  <div className="flex gap-2">
                    <button type="submit" disabled={busy} className="btn-primary !px-4 !py-2">
                      <Send size={14} aria-hidden="true" /> {busy ? 'Отправляем…' : 'Отправить'}
                    </button>
                    <button type="button" onClick={() => setDraft(null)} className="btn-ghost !px-4 !py-2">
                      Отмена
                    </button>
                  </div>
                </form>
              ) : message ? (
                <article className="border border-border p-4">
                  <h2 className="text-lg font-bold">{message.subject || '(без темы)'}</h2>
                  <p className="meta mt-1 !normal-case tracking-normal">
                    от {message.from} · кому {message.to} · {when(message.date)}
                  </p>
                  <pre className="mt-4 whitespace-pre-wrap break-words font-sans text-sm">{message.text.trim() || '(пустое письмо)'}</pre>
                  {message.attachments.length > 0 && (
                    <ul className="mt-4 flex flex-wrap gap-2">
                      {message.attachments.map((a) => (
                        <li key={a.id}>
                          <button type="button" onClick={() => void download(message, a)} className="btn-ghost !px-3 !py-1.5 !text-[11px]">
                            <Paperclip size={12} aria-hidden="true" /> {a.filename} · {kb(a.size)}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  {box !== 'noreply' && (
                    <button
                      type="button"
                      onClick={() =>
                        setDraft({
                          to: firstAddress(message.replyTo ?? message.from),
                          subject: /^re:/i.test(message.subject) ? message.subject : `Re: ${message.subject}`,
                          text: `\n\n${message.from} пишет ${when(message.date)}:\n${message.text.trim().split('\n').map((l) => `> ${l}`).join('\n')}`,
                          replyToUid: message.uid,
                        })
                      }
                      className="btn-primary mt-5 !px-4 !py-2"
                    >
                      <Reply size={14} aria-hidden="true" /> Ответить
                    </button>
                  )}
                </article>
              ) : (
                <p className="border border-dashed border-border p-6 text-sm text-muted-foreground">Выберите письмо слева.</p>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
