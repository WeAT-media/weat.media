import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { BookOpen, Trash2 } from 'lucide-react'

interface Allowed {
  did: string
  note: string | null
  added_at: string
  backfilled_at: string | null
  handle: string | null
  docs: number
}

const field = 'rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

/** Белый список авторов standard.site (Leaflet, pckt…): только их документы попадают в ленту */
export default function StandardAllowPanel({ token }: { token: string }) {
  const [list, setList] = useState<Allowed[] | null>(null)
  const [form, setForm] = useState({ id: '', note: '' })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const auth = { authorization: `Bearer ${token}` }

  // ответ сервера → список или текст ошибки
  const fetchList = useCallback(
    () =>
      fetch('/api/admin/standard', { headers: { authorization: `Bearer ${token}` } })
        .then(async (res) => (res.ok ? { list: (await res.json()) as Allowed[], error: '' } : { list: [], error: ((await res.json().catch(() => null)) as { message?: string } | null)?.message ?? `Ошибка ${res.status}` }))
        .catch(() => ({ list: [] as Allowed[], error: 'Сервер не отвечает' })),
    [token],
  )
  const load = useCallback(async () => {
    const r = await fetchList()
    setList(r.list)
    setError(r.error)
  }, [fetchList])

  useEffect(() => {
    let alive = true
    fetchList().then((r) => {
      if (!alive) return
      setList(r.list)
      setError(r.error)
    })
    return () => {
      alive = false
    }
  }, [fetchList])

  const add = async (e: FormEvent) => {
    e.preventDefault()
    if (!form.id.trim()) return
    setBusy(true)
    setError('')
    const res = await fetch('/api/admin/standard', { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ id: form.id.trim(), ...(form.note.trim() ? { note: form.note.trim() } : {}) }) }).catch(() => null)
    setBusy(false)
    if (!res?.ok) {
      setError(res ? ((await res.json().catch(() => null)) as { message?: string } | null)?.message ?? `Ошибка ${res.status}` : 'Сервер не отвечает')
      return
    }
    setForm({ id: '', note: '' })
    await load()
  }

  const remove = async (a: Allowed) => {
    if (!window.confirm(`Убрать ${a.handle ?? a.did} из ленты? Его документы (${a.docs}) исчезнут из индекса.`)) return
    const res = await fetch(`/api/admin/standard/${encodeURIComponent(a.did)}`, { method: 'DELETE', headers: auth }).catch(() => null)
    if (!res?.ok) setError('Не удалось убрать автора')
    await load()
  }

  return (
    <section className="rule pt-8" aria-labelledby="standard-allow-title">
      <h2 id="standard-allow-title" className="inline-flex items-center gap-2 text-xl font-extrabold tracking-tight">
        <BookOpen size={17} className="text-accent" aria-hidden="true" /> standard.site: авторы в ленте
      </h2>
      <p className="mt-2 max-w-[66ch] text-sm leading-relaxed text-muted-foreground">
        Документы site.standard.document (Leaflet, pckt и другие площадки) читаются из всей сети, но в ленту попадают только
        авторы из этого списка. После добавления история автора догружается в течение минуты. Список у каждого контура свой.
      </p>
      <form onSubmit={add} className="mt-4 grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
        <input value={form.id} onChange={(e) => setForm({ ...form, id: e.target.value })} placeholder="handle или DID" aria-label="Handle или DID автора" className={field} />
        <input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="заметка (почему добавили)" aria-label="Заметка" className={field} />
        <button type="submit" disabled={busy} className="btn-primary !px-4 !py-2">Добавить</button>
      </form>
      {error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}
      {list === null ? (
        <p className="meta mt-4">загрузка…</p>
      ) : list.length === 0 ? (
        <p className="meta mt-4">Список пуст — документы standard.site в ленту не попадают.</p>
      ) : (
        <ul className="mt-4 divide-y divide-border border-y border-border">
          {list.map((a) => (
            <li key={a.did} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
              <div className="min-w-0">
                <p className="font-semibold">{a.handle ? `@${a.handle}` : a.did}</p>
                <p className="meta mt-0.5 !normal-case tracking-normal">
                  {a.handle && <span className="font-mono">{a.did} · </span>}
                  {a.backfilled_at ? `документов: ${a.docs}` : 'догружается…'}
                  {a.note && ` · ${a.note}`}
                </p>
              </div>
              <button type="button" onClick={() => void remove(a)} aria-label={`Убрать ${a.handle ?? a.did}`} className="btn-ghost !px-3 !py-1.5">
                <Trash2 size={13} aria-hidden="true" /> Убрать
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
