import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router'
import { Check, ShieldCheck, X } from 'lucide-react'
import { SITE_NAME } from '@/config/site'
import { formatMoney, type Currency } from '@/lib/money'
import { staffAuthConfigured, staffLogin, staffToken } from '@/lib/staffAuth'

/**
 * Заявки авторов на выплату (только admin). Перевод делается вне сайта; здесь — отметка «выплачено»
 * или отказ с причиной (её видит автор, сумма снова доступна). Реквизиты целиком видит только сотрудник.
 */

type Status = 'requested' | 'paid' | 'rejected'

interface Payout {
  id: string
  authorDid: string
  amount: number
  currency: Currency
  method: 'fiat' | 'crypto'
  destination: string
  destinationHint: string
  status: Status
  staffNote: string | null
  createdAt: string
  decidedAt: string | null
}

const TABS: { id: Status; label: string }[] = [
  { id: 'requested', label: 'Ждут' },
  { id: 'paid', label: 'Выплачены' },
  { id: 'rejected', label: 'Отклонены' },
]

const when = (iso: string) => new Date(iso).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

export default function AdminPayoutsPage() {
  const token = staffToken()
  const [tab, setTab] = useState<Status>('requested')
  const [rows, setRows] = useState<Payout[]>([])
  const [notes, setNotes] = useState<Record<string, string>>({})
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
    call<Payout[]>(`/admin/payouts?status=${tab}`).then(setRows, (e: Error) => setError(e.message))
  }, [call, tab])
  useEffect(() => {
    if (token) load()
  }, [token, load])

  const decide = async (p: Payout, status: 'paid' | 'rejected') => {
    setError('')
    try {
      await call(`/admin/payouts/${p.id}`, { method: 'PATCH', body: JSON.stringify({ status, ...(notes[p.id]?.trim() ? { note: notes[p.id]!.trim() } : {}) }) })
      load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось')
    }
  }

  if (!token) {
    return (
      <div className="mx-auto max-w-[520px] px-5 py-20">
        <h1 className="text-3xl font-extrabold tracking-tight">Выплаты</h1>
        {staffAuthConfigured ? (
          <button type="button" onClick={() => void staffLogin('/admin/payouts')} className="btn-primary mt-6 w-full !py-2.5">
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
          <p className="meta">Админка · деньги</p>
          <h1 className="mt-2 text-4xl font-extrabold tracking-tight">Выплаты авторам</h1>
          <p className="mt-2 max-w-[66ch] text-sm text-muted-foreground">
            Переведите сумму вне сайта и отметьте «Выплачено». Отказ — только с причиной: её увидит автор, сумма вернётся в доступные.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link to="/admin/tickets" className="btn-ghost !px-3 !py-2 !text-[11px]">Обращения</Link>
          <Link to="/admin/email" className="btn-ghost !px-3 !py-2 !text-[11px]">Почта</Link>
        </div>
      </div>

      <div role="tablist" className="mt-6 flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={`rounded-md border px-3 py-1.5 font-mono text-[11px] font-semibold uppercase tracking-[0.08em] ${tab === t.id ? 'border-accent text-accent' : 'border-border text-muted-foreground hover:text-foreground'}`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {error && <p role="alert" className="mt-4 text-sm text-destructive">{error}</p>}

      <ul className="mt-4 space-y-3">
        {rows.length === 0 && <li className="text-sm text-muted-foreground">Заявок нет.</li>}
        {rows.map((p) => (
          <li key={p.id} className="border border-border p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <p className="text-lg font-bold">{formatMoney(p.amount / 100, p.currency)}</p>
              <p className="meta">{when(p.createdAt)} · {p.id}</p>
            </div>
            <p className="mt-1 break-all font-mono text-sm">
              {p.method === 'crypto' ? 'крипта' : 'фиат'}: {p.destination}
            </p>
            <p className="meta mt-1 break-all !normal-case tracking-normal">автор {p.authorDid}</p>
            {p.staffNote && <p className="mt-2 text-sm">Комментарий: {p.staffNote}</p>}
            {p.status === 'requested' && (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <input
                  value={notes[p.id] ?? ''}
                  onChange={(e) => setNotes((n) => ({ ...n, [p.id]: e.target.value }))}
                  placeholder="комментарий (для отказа обязателен)"
                  aria-label="Комментарий к решению"
                  className="min-w-[240px] flex-1 rounded-md border border-input bg-background px-3 py-1.5 text-sm"
                />
                <button type="button" onClick={() => void decide(p, 'paid')} className="btn-primary !px-3 !py-1.5 !text-[11px]">
                  <Check size={13} aria-hidden="true" /> Выплачено
                </button>
                <button type="button" onClick={() => void decide(p, 'rejected')} className="btn-ghost !px-3 !py-1.5 !text-[11px]">
                  <X size={13} aria-hidden="true" /> Отклонить
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
