import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { LogIn, ShieldCheck } from 'lucide-react'
import { HANDLE_DOMAIN, SITE_NAME } from '@/config/site'
import { staffAuthConfigured, staffLogin, staffToken } from '@/lib/staffAuth'

/**
 * Системные учётки (только admin): news, crawler, justice, коллегии и свои.
 * «Войти как» открывает обычную сессию учётки в этом браузере — пишите из редактора как автор.
 * Вход пишется в журнал; в учётки людей так войти нельзя.
 */

interface Account { did: string; handle: string; displayName: string | null; service: string; canLogin: boolean; createdAt: string }

const field = 'rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
const KIND: Record<string, string> = { system: 'системная', labeler: 'коллегия', crawler: 'краулер' }

export default function AdminSystemPage() {
  const token = staffToken()
  const [rows, setRows] = useState<Account[]>([])
  const [form, setForm] = useState({ username: '', displayName: '', description: '' })
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const call = useCallback(
    async <T,>(path: string, init: RequestInit = {}): Promise<T> => {
      const res = await fetch(`/api${path}`, { ...init, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` } })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.message ?? `Ошибка ${res.status}`)
      return body as T
    },
    [token],
  )
  const load = useCallback(() => {
    call<Account[]>('/admin/system-accounts').then(setRows, (e: Error) => setError(e.message))
  }, [call])
  useEffect(() => {
    if (token) load()
  }, [token, load])

  const create = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    try {
      const a = await call<Account>('/admin/system-accounts', { method: 'POST', body: JSON.stringify({ ...form, description: form.description || undefined }) })
      setNotice(`Создана @${a.handle}`)
      setForm({ username: '', displayName: '', description: '' })
      load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось')
    }
  }

  const loginAs = async (a: Account) => {
    if (!window.confirm(`Войти в @${a.handle}? Текущая сессия читателя в этом браузере сменится на эту учётку.`)) return
    try {
      const { code } = await call<{ code: string }>(`/admin/system-accounts/${encodeURIComponent(a.did)}/login`, { method: 'POST' })
      window.location.assign(`/login?${new URLSearchParams({ handoff: code, returnTo: '/compose' })}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось')
    }
  }

  if (!token) {
    return (
      <div className="mx-auto max-w-[520px] px-5 py-20">
        <h1 className="text-3xl font-extrabold tracking-tight">Системные учётки</h1>
        {staffAuthConfigured ? (
          <button type="button" onClick={() => void staffLogin('/admin/system')} className="btn-primary mt-6 w-full !py-2.5">
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
          <p className="meta">Админка · учётки</p>
          <h1 className="mt-2 text-4xl font-extrabold tracking-tight">Системные учётки</h1>
          <p className="mt-2 max-w-[66ch] text-sm text-muted-foreground">
            Учётки площадки: новости, служебные, коллегии. Пароль знает только сервер; «Войти как» открывает обычную сессию — пишите из редактора.
          </p>
        </div>
        <Link to="/admin/users" className="btn-ghost !px-3 !py-2 !text-[11px]">Пользователи</Link>
      </div>

      {error && <p role="alert" className="mt-4 text-sm text-destructive">{error}</p>}
      {notice && <p className="mt-4 text-sm">{notice}</p>}

      <ul className="mt-6 space-y-2">
        {rows.length === 0 && <li className="text-sm text-muted-foreground">Системных учёток нет.</li>}
        {rows.map((a) => (
          <li key={a.did} className="flex flex-wrap items-center justify-between gap-2 border border-border px-4 py-3">
            <span className="min-w-0">
              <b>{a.displayName ?? a.handle}</b> <span className="meta">@{a.handle} · {KIND[a.service] ?? a.service}</span>
            </span>
            <span className="flex gap-2">
              <Link to={`/profile/${a.handle}`} className="btn-ghost !px-3 !py-1.5 !text-[11px]">Профиль</Link>
              <button type="button" disabled={!a.canLogin} onClick={() => void loginAs(a)} title={a.canLogin ? undefined : 'пароль учётки не хранится на сервере'} className="btn-primary !px-3 !py-1.5 !text-[11px] disabled:opacity-50">
                <LogIn size={13} aria-hidden="true" /> Войти как
              </button>
            </span>
          </li>
        ))}
      </ul>

      <form onSubmit={create} className="mt-8 grid gap-3 border border-border p-4 md:grid-cols-2">
        <h2 className="font-mono text-[13px] font-bold uppercase tracking-[0.12em] md:col-span-2">Новая системная учётка</h2>
        <label className="grid gap-1 text-sm">
          Имя (handle)
          <span className="flex items-center gap-1">
            <input required value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} placeholder="news" className={`${field} flex-1`} />
            <span className="meta">.{HANDLE_DOMAIN}</span>
          </span>
        </label>
        <label className="grid gap-1 text-sm">
          Название
          <input required value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} placeholder="Новости weAT.media" className={field} />
        </label>
        <label className="grid gap-1 text-sm md:col-span-2">
          Описание профиля
          <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Обновления и новые функции" className={field} />
        </label>
        <button type="submit" className="btn-primary !px-4 !py-2 md:w-fit">Создать</button>
      </form>
    </div>
  )
}
