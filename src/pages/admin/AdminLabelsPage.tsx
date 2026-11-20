import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { ShieldCheck } from 'lucide-react'
import { SITE_NAME } from '@/config/site'
import { staffAuthConfigured, staffLogin, staffToken } from '@/lib/staffAuth'

/**
 * Метки коллегий присяжных (роль moderator): поставить или снять метку на статью/аккаунт по решению коллегии.
 * Метку подписывает сервис коллегии (<id>.justice.weat.media); читатели видят её по своим настройкам модерации.
 */

interface LabelerInfo { id: string; did: string; handle: string; name: string; labels: { value: string; description: string }[] }
interface Label { src: string; uri: string; val: string; cts: string; neg?: boolean }

const field = 'rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
const when = (iso: string) => new Date(iso).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

export default function AdminLabelsPage() {
  const token = staffToken()
  const [labelers, setLabelers] = useState<LabelerInfo[]>([])
  const [form, setForm] = useState({ labeler: '', val: '', uri: '', note: '' })
  const [current, setCurrent] = useState<Label[]>([])
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  useEffect(() => {
    fetch('/api/admin/labelers', { headers: token ? { authorization: `Bearer ${token}` } : {} })
      .then((r) => r.json())
      .then((d: { labelers?: LabelerInfo[]; message?: string }) => {
        if (!d.labelers) throw new Error(d.message ?? 'Сервис коллегий недоступен')
        setLabelers(d.labelers)
        const first = d.labelers[0]
        if (first) setForm((f) => ({ ...f, labeler: first.id, val: first.labels[0]?.value ?? '' }))
      })
      .catch((e: Error) => setError(e.message))
  }, [token])

  const lookup = useCallback(async (uri: string) => {
    if (!uri.startsWith('at://') && !uri.startsWith('did:')) return setCurrent([])
    const d = (await (await fetch(`/api/labels?${new URLSearchParams({ uris: uri })}`)).json()) as { labels?: Label[] }
    setCurrent(d.labels ?? [])
  }, [])

  const send = async (neg: boolean, override?: { labeler: string; val: string }) => {
    setError('')
    setNotice('')
    const body = { labeler: override?.labeler ?? form.labeler, val: override?.val ?? form.val, uri: form.uri.trim(), neg, ...(form.note.trim() ? { note: form.note.trim() } : {}) }
    const res = await fetch('/api/admin/labels', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify(body) })
    const d = await res.json().catch(() => ({}))
    if (!res.ok) return setError(d.message ?? `Ошибка ${res.status}`)
    setNotice(neg ? `Снята: ${body.val}` : `Поставлена: ${body.val}`)
    await lookup(body.uri)
  }

  if (!token) {
    return (
      <div className="mx-auto max-w-[520px] px-5 py-20">
        <h1 className="text-3xl font-extrabold tracking-tight">Метки коллегий</h1>
        {staffAuthConfigured ? (
          <button type="button" onClick={() => void staffLogin('/admin/labels')} className="btn-primary mt-6 w-full !py-2.5">
            <ShieldCheck size={15} aria-hidden="true" /> Войти через {SITE_NAME}
          </button>
        ) : (
          <p className="mt-4 text-sm text-muted-foreground">Вход сотрудников не настроен (VITE_ZITADEL_*).</p>
        )}
      </div>
    )
  }

  const collegium = labelers.find((l) => l.id === form.labeler)
  const nameOf = (did: string) => labelers.find((l) => l.did === did)

  return (
    <div className="mx-auto max-w-[1100px] px-5 pb-24 md:px-8">
      <div className="flex flex-wrap items-end justify-between gap-4 pt-10">
        <div>
          <p className="meta">Админка · модерация</p>
          <h1 className="mt-2 text-4xl font-extrabold tracking-tight">Метки коллегий</h1>
          <p className="mt-2 max-w-[66ch] text-sm text-muted-foreground">
            Метка не удаляет запись: читатель скроет её или увидит предупреждение по своим настройкам. Каждое решение — в журнале сотрудников.
          </p>
        </div>
        <span className="flex gap-2">
          <Link to="/admin/cooldown" className="btn-ghost !px-3 !py-2 !text-[11px]">Охлаждение</Link>
          <Link to="/admin/tickets" className="btn-ghost !px-3 !py-2 !text-[11px]">Обращения</Link>
        </span>
      </div>

      {error && <p role="alert" className="mt-4 text-sm text-destructive">{error}</p>}
      {notice && <p className="mt-4 text-sm">{notice}</p>}

      <form
        onSubmit={(e: FormEvent) => {
          e.preventDefault()
          void send(false)
        }}
        className="mt-6 grid gap-3 border border-border p-4 md:grid-cols-2"
      >
        <input
          required
          value={form.uri}
          onChange={(e) => setForm({ ...form, uri: e.target.value })}
          onBlur={() => void lookup(form.uri.trim())}
          placeholder="at://did:…/media.weat.article/… или did:…"
          aria-label="Запись или аккаунт"
          className={`${field} md:col-span-2`}
        />
        <select
          value={form.labeler}
          onChange={(e) => {
            const l = labelers.find((x) => x.id === e.target.value)
            setForm({ ...form, labeler: e.target.value, val: l?.labels[0]?.value ?? '' })
          }}
          aria-label="Коллегия"
          className={field}
        >
          {labelers.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name} · {l.handle}
            </option>
          ))}
        </select>
        <select value={form.val} onChange={(e) => setForm({ ...form, val: e.target.value })} aria-label="Метка" className={field}>
          {collegium?.labels.map((v) => (
            <option key={v.value} value={v.value}>
              {v.description} ({v.value})
            </option>
          ))}
        </select>
        <input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="дело / основание (в журнал)" aria-label="Основание" className={`${field} md:col-span-2`} />
        <button type="submit" className="btn-primary !px-4 !py-2 md:w-fit">Поставить метку</button>
      </form>

      <section aria-label="Действующие метки" className="mt-6">
        <h2 className="font-mono text-[13px] font-bold uppercase tracking-[0.12em]">Действующие метки</h2>
        {current.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">Введите адрес записи — здесь появятся её метки.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {current.map((l) => {
              const c = nameOf(l.src)
              return (
                <li key={`${l.src}-${l.val}`} className="flex flex-wrap items-center justify-between gap-2 border border-border px-4 py-2.5 text-sm">
                  <span>
                    <b>{l.val}</b> <span className="meta">· {c?.name ?? l.src} · {when(l.cts)}</span>
                  </span>
                  {c && (
                    <button type="button" onClick={() => void send(true, { labeler: c.id, val: l.val })} className="btn-ghost !px-3 !py-1.5 !text-[11px]">
                      Снять
                    </button>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </div>
  )
}
