import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Ban, Globe, Trash2 } from 'lucide-react'

interface Platform {
  content_type: string
  name: string
  url: string | null
  enabled: boolean
  docs: number
}

interface Blocked {
  did: string
  note: string | null
  added_at: string
  handle: string | null
}

const field = 'rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

const message = async (res: Response | null) =>
  res ? ((await res.json().catch(() => null)) as { message?: string } | null)?.message ?? `Ошибка ${res.status}` : 'Сервер не отвечает'

/** Площадки standard.site целиком (Leaflet, pckt, Offprint) и блок-лист авторов со спамом */
export default function StandardPlatformsPanel({ token }: { token: string }) {
  const [platforms, setPlatforms] = useState<Platform[] | null>(null)
  const [blocked, setBlocked] = useState<Blocked[]>([])
  const [form, setForm] = useState({ id: '', note: '' })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const fetchAll = useCallback(async () => {
    const auth = { authorization: `Bearer ${token}` }
    const [p, b] = await Promise.all([
      fetch('/api/admin/standard/platforms', { headers: auth }).catch(() => null),
      fetch('/api/admin/standard/block', { headers: auth }).catch(() => null),
    ])
    if (!p?.ok) return { platforms: [] as Platform[], blocked: [] as Blocked[], error: await message(p) }
    return { platforms: (await p.json()) as Platform[], blocked: b?.ok ? ((await b.json()) as Blocked[]) : [], error: b?.ok ? '' : await message(b) }
  }, [token])

  const load = useCallback(async () => {
    const r = await fetchAll()
    setPlatforms(r.platforms)
    setBlocked(r.blocked)
    setError(r.error)
  }, [fetchAll])

  useEffect(() => {
    let alive = true
    fetchAll().then((r) => {
      if (!alive) return
      setPlatforms(r.platforms)
      setBlocked(r.blocked)
      setError(r.error)
    })
    return () => {
      alive = false
    }
  }, [fetchAll])

  const toggle = async (p: Platform) => {
    if (p.enabled && !window.confirm(`Выключить ${p.name}? Документы площадки (${p.docs}) уйдут из ленты, кроме авторов из белого списка.`)) return
    setBusy(true)
    const res = await fetch('/api/admin/standard/platforms', { method: 'PUT', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ contentType: p.content_type, enabled: !p.enabled }) }).catch(() => null)
    setBusy(false)
    if (!res?.ok) setError(await message(res))
    await load()
  }

  const block = async (e: FormEvent) => {
    e.preventDefault()
    if (!form.id.trim()) return
    setBusy(true)
    setError('')
    const res = await fetch('/api/admin/standard/block', { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ id: form.id.trim(), ...(form.note.trim() ? { note: form.note.trim() } : {}) }) }).catch(() => null)
    setBusy(false)
    if (!res?.ok) return setError(await message(res))
    setForm({ id: '', note: '' })
    await load()
  }

  const unblock = async (b: Blocked) => {
    const res = await fetch(`/api/admin/standard/block/${encodeURIComponent(b.did)}`, { method: 'DELETE', headers: { authorization: `Bearer ${token}` } }).catch(() => null)
    if (!res?.ok) setError(await message(res))
    await load()
  }

  return (
    <section className="rule pt-8" aria-labelledby="standard-platforms-title">
      <h2 id="standard-platforms-title" className="inline-flex items-center gap-2 text-xl font-extrabold tracking-tight">
        <Globe size={17} className="text-accent" aria-hidden="true" /> standard.site: площадки целиком
      </h2>
      <p className="mt-2 max-w-[66ch] text-sm leading-relaxed text-muted-foreground">
        Документы включённой площадки попадают в ленту без белого списка авторов (короче 280 символов — нет). При включении лента
        догружает документы площадки за последние сутки. Спам отдельного автора — в блок-лист ниже. Настройки у каждого контура свои.
      </p>
      {error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}
      {platforms === null ? (
        <p className="meta mt-4">загрузка…</p>
      ) : (
        <ul className="mt-4 divide-y divide-border border-y border-border">
          {platforms.map((p) => (
            <li key={p.content_type} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
              <div className="min-w-0">
                <p className="font-semibold">
                  {p.url ? <a href={p.url} target="_blank" rel="noreferrer" className="hover:text-accent">{p.name}</a> : p.name}
                </p>
                <p className="meta mt-0.5 !normal-case tracking-normal">
                  <span className="font-mono">{p.content_type}</span> · документов в ленте: {p.docs}
                </p>
              </div>
              <label className="inline-flex items-center gap-2">
                <input type="checkbox" checked={p.enabled} disabled={busy} onChange={() => void toggle(p)} className="h-4 w-4" />
                {p.enabled ? 'в ленте' : 'выключена'}
              </label>
            </li>
          ))}
        </ul>
      )}

      <h3 className="mt-8 inline-flex items-center gap-2 text-base font-bold">
        <Ban size={15} aria-hidden="true" /> Заблокированные авторы
      </h3>
      <form onSubmit={block} className="mt-3 grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
        <input value={form.id} onChange={(e) => setForm({ ...form, id: e.target.value })} placeholder="handle или DID" aria-label="Handle или DID автора для блокировки" className={field} />
        <input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="причина (спам, SEO…)" aria-label="Причина блокировки" className={field} />
        <button type="submit" disabled={busy} className="btn-ghost !px-4 !py-2">Заблокировать</button>
      </form>
      {blocked.length > 0 && (
        <ul className="mt-3 divide-y divide-border border-y border-border">
          {blocked.map((b) => (
            <li key={b.did} className="flex flex-wrap items-center justify-between gap-3 py-2.5 text-sm">
              <p className="min-w-0">
                <span className="font-semibold">{b.handle ? `@${b.handle}` : b.did}</span>
                {b.note && <span className="meta !normal-case tracking-normal"> · {b.note}</span>}
              </p>
              <button type="button" onClick={() => void unblock(b)} aria-label={`Разблокировать ${b.handle ?? b.did}`} className="btn-ghost !px-3 !py-1.5">
                <Trash2 size={13} aria-hidden="true" /> Снять
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
