import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { ShieldCheck } from 'lucide-react'
import { SITE_NAME } from '@/config/site'
import { formatMoney, type Currency } from '@/lib/money'
import { staffAuthConfigured, staffLogin, staffToken } from '@/lib/staffAuth'

/**
 * Финансы площадки (только admin): продажи и комиссия по валютам, заявки и выплаты, ручные корректировки баланса.
 * Корректировка не удаляется — ошибку исправляют обратной корректировкой. Всё пишется в журнал сотрудников.
 */

interface Totals {
  currency: Currency
  gross: number
  platformFee: number
  authorShare: number
  orders: number
  refunded: number
  payoutsRequested: number
  payoutsPaid: number
  adjustments: number
}
interface Order { id: string; title: string; readerDid: string; authorDid: string; amount: number; authorShare: number; platformFee: number; currency: Currency; status: string; createdAt: string }
interface Adjustment { id: string; did: string; amount: number; currency: Currency; reason: string; createdBy: string; createdAt: string }
interface Balance { currency: Currency; earned: number; pending: number; reserved: number; paidOut: number; available: number }
interface UserCard { did: string; handle: string; balances: Balance[]; adjustments: Adjustment[] }

const money = (minor: number, c: Currency) => formatMoney(minor / 100, c)
const when = (iso: string) => new Date(iso).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
const field = 'rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

export default function AdminFinancePage() {
  const token = staffToken()
  const [data, setData] = useState<{ totals: Totals[]; orders: Order[]; adjustments: Adjustment[] } | null>(null)
  const [query, setQuery] = useState('')
  const [card, setCard] = useState<UserCard | null>(null)
  const [form, setForm] = useState({ sign: '+' as '+' | '-', amount: '', currency: 'RUB' as Currency, reason: '' })
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
    call<typeof data & object>('/admin/finance/summary').then(setData, (e: Error) => setError(e.message))
  }, [call])
  useEffect(() => {
    if (token) load()
  }, [token, load])

  const findUser = async (id: string) => {
    setError('')
    setNotice('')
    try {
      setCard(await call<UserCard>(`/admin/finance/users/${encodeURIComponent(id.trim().replace(/^@/, ''))}`))
    } catch (e) {
      setCard(null)
      setError(e instanceof Error ? e.message : 'Не найден')
    }
  }

  const adjust = async (e: FormEvent) => {
    e.preventDefault()
    if (!card) return
    const minor = Math.round(Number(form.amount.replace(',', '.')) * 100)
    if (!Number.isFinite(minor) || minor <= 0) return setError('Сумма — положительное число')
    setError('')
    try {
      await call('/admin/finance/adjustments', {
        method: 'POST',
        body: JSON.stringify({ user: card.did, amount: form.sign === '-' ? -minor : minor, currency: form.currency, reason: form.reason }),
      })
      setNotice(`${form.sign === '-' ? 'Списано' : 'Начислено'} ${money(minor, form.currency)} · @${card.handle}`)
      setForm((f) => ({ ...f, amount: '', reason: '' }))
      await findUser(card.did)
      load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось')
    }
  }

  if (!token) {
    return (
      <div className="mx-auto max-w-[520px] px-5 py-20">
        <h1 className="text-3xl font-extrabold tracking-tight">Финансы</h1>
        {staffAuthConfigured ? (
          <button type="button" onClick={() => void staffLogin('/admin/finance')} className="btn-primary mt-6 w-full !py-2.5">
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
          <h1 className="mt-2 text-4xl font-extrabold tracking-tight">Финансы площадки</h1>
          <p className="mt-2 max-w-[66ch] text-sm text-muted-foreground">
            Продажи через lava.top, комиссия площадки и долги авторам. Корректировка баланса сразу доступна к выводу и не удаляется.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link to="/admin/payouts" className="btn-ghost !px-3 !py-2 !text-[11px]">Выплаты</Link>
          <Link to="/admin/users" className="btn-ghost !px-3 !py-2 !text-[11px]">Пользователи</Link>
        </div>
      </div>

      {error && <p role="alert" className="mt-4 text-sm text-destructive">{error}</p>}
      {notice && <p className="mt-4 text-sm">{notice}</p>}

      <section aria-label="Итоги" className="mt-6 space-y-4">
        {data?.totals.length === 0 && <p className="text-sm text-muted-foreground">Продаж пока нет.</p>}
        {data?.totals.map((t) => (
          <div key={t.currency} className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {(
              [
                ['Оборот', t.gross, `${t.orders} заказов`],
                ['Комиссия площадки', t.platformFee, 'доход'],
                ['Должны авторам', t.authorShare + t.adjustments - t.payoutsPaid, `корректировки ${money(t.adjustments, t.currency)}`],
                ['Выплачено', t.payoutsPaid, `ждут ${money(t.payoutsRequested, t.currency)}`],
              ] as const
            ).map(([label, v, sub]) => (
              <div key={label} className="border border-border bg-secondary/40 p-4">
                <p className="text-xl font-extrabold tracking-tight">{money(v, t.currency)}</p>
                <p className="meta mt-1">{label}</p>
                <p className="meta !normal-case tracking-normal text-muted-foreground">{sub}</p>
              </div>
            ))}
          </div>
        ))}
      </section>

      <section aria-label="Баланс пользователя" className="rule mt-10 pt-8">
        <h2 className="font-mono text-[13px] font-bold uppercase tracking-[0.12em]">Баланс пользователя</h2>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (query.trim()) void findUser(query)
          }}
          className="mt-4 flex flex-wrap gap-2"
        >
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="handle или DID" aria-label="handle или DID" className={`${field} min-w-[260px] flex-1`} />
          <button type="submit" className="btn-primary !px-4 !py-2">Найти</button>
        </form>

        {card && (
          <div className="mt-5 border border-border p-4">
            <p className="font-semibold">@{card.handle}</p>
            <p className="meta break-all !normal-case tracking-normal">{card.did}</p>
            <ul className="mt-3 space-y-1 text-sm">
              {card.balances.length === 0 && <li className="text-muted-foreground">Баланса нет.</li>}
              {card.balances.map((b) => (
                <li key={b.currency}>
                  <b>{money(b.available, b.currency)}</b> доступно · {money(b.pending, b.currency)} ожидает · {money(b.reserved, b.currency)} в заявках · всего {money(b.earned, b.currency)}
                </li>
              ))}
            </ul>

            <form onSubmit={adjust} className="mt-4 flex flex-wrap items-end gap-2">
              <select value={form.sign} onChange={(e) => setForm({ ...form, sign: e.target.value as '+' | '-' })} aria-label="Начислить или списать" className={field}>
                <option value="+">Начислить</option>
                <option value="-">Списать</option>
              </select>
              <input required inputMode="decimal" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} placeholder="сумма" aria-label="Сумма" className={`${field} w-32`} />
              <select value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value as Currency })} aria-label="Валюта" className={field}>
                <option value="RUB">RUB</option>
                <option value="USD">USD</option>
                <option value="EUR">EUR</option>
              </select>
              <input required minLength={5} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder="причина (увидит команда в журнале)" aria-label="Причина" className={`${field} min-w-[240px] flex-1`} />
              <button type="submit" className="btn-primary !px-4 !py-2">Провести</button>
            </form>

            {card.adjustments.length > 0 && (
              <ul className="mt-4 space-y-1 text-sm">
                {card.adjustments.map((a) => (
                  <li key={a.id} className="text-muted-foreground">
                    {when(a.createdAt)} · <span className={a.amount < 0 ? 'text-destructive' : 'text-foreground'}>{a.amount > 0 ? '+' : ''}{money(a.amount, a.currency)}</span> · {a.reason} · {a.createdBy}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </section>

      <section aria-label="Последние заказы" className="rule mt-10 pt-8">
        <h2 className="font-mono text-[13px] font-bold uppercase tracking-[0.12em]">Последние заказы</h2>
        <ul className="mt-4 space-y-2">
          {data?.orders.length === 0 && <li className="text-sm text-muted-foreground">Заказов нет.</li>}
          {data?.orders.map((o) => (
            <li key={o.id} className="flex flex-wrap items-baseline justify-between gap-2 border border-border px-4 py-2.5 text-sm">
              <span className="min-w-0 truncate">
                <b>{o.title}</b> <span className="meta">· {o.status} · {when(o.createdAt)}</span>
              </span>
              <span className="font-mono">
                {money(o.amount, o.currency)} <span className="meta">автору {money(o.authorShare, o.currency)} · площадке {money(o.platformFee, o.currency)}</span>
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
