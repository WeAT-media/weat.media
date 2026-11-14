import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router'
import { Search, ShieldCheck } from 'lucide-react'
import { SITE_NAME } from '@/config/site'
import { countryLabel } from '@/lib/api'
import { staffAuthConfigured, staffLogin, staffToken } from '@/lib/staffAuth'
import CountrySelect from '@/components/CountrySelect'
import DevicesList, { type DeviceSession } from '@/components/DevicesList'

/** Поддержка: пользователи — карточка, страны (резидентство меняется по заявке), прямое сообщение */

interface AdminUser {
  did: string
  handle: string
  displayName: string | null
  tier: 'free' | 'premium'
  createdAt: string
  signupCountry: string
  residenceCountry: string
  /** служебная учётка (labeler — коллегия присяжных) */
  service: string | null
}
interface UserCard extends AdminUser {
  tickets: { id: string; subject: string; status: string; createdAt: string; category: string }[]
}

const when = (iso: string) => new Date(iso).toLocaleString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' })
const TICKET_STATUS: Record<string, string> = { new: 'новое', in_progress: 'в работе', waiting: 'ждёт ответа', resolved: 'решено', rejected: 'отклонено' }

export default function AdminUsersPage() {
  const token = staffToken()
  const [q, setQ] = useState('')
  const [rows, setRows] = useState<AdminUser[]>([])
  const [card, setCard] = useState<UserCard | null>(null)
  const [residence, setResidence] = useState<string[]>([])
  const [ticketRef, setTicketRef] = useState('')
  const [subject, setSubject] = useState('')
  const [text, setText] = useState('')
  const [done, setDone] = useState('')
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
  const [onlyService, setOnlyService] = useState(false)
  const search = useCallback(
    (term: string) =>
      call<AdminUser[]>(`/admin/users?${new URLSearchParams({ q: term, ...(onlyService ? { service: '1' } : {}) })}`).then(setRows, (e) => setError(e.message)),
    [call, onlyService],
  )
  useEffect(() => {
    if (token) void search('')
  }, [token, search])

  const open = async (did: string) => {
    setError('')
    setDone('')
    try {
      const c = await call<UserCard>(`/admin/users/${encodeURIComponent(did)}`)
      setCard(c)
      setResidence([c.residenceCountry])
      setTicketRef('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось')
    }
  }

  const [tierReason, setTierReason] = useState('')
  /** Premium вручную — например, оплата прошла, а подписка не включилась; причина — в журнал */
  const changeTier = async (tier: 'free' | 'premium') => {
    if (!card) return
    if (tierReason.trim().length < 5) return setError('Укажите причину — от 5 символов')
    setError('')
    try {
      await call(`/admin/users/${encodeURIComponent(card.did)}/tier`, { method: 'PUT', body: JSON.stringify({ tier, reason: tierReason.trim() }) })
      setDone(tier === 'premium' ? `Premium выдан: @${card.handle}` : `Premium снят: @${card.handle}`)
      setTierReason('')
      await open(card.did)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось')
    }
  }

  const changeResidence = async () => {
    if (!card || !residence[0] || residence[0] === card.residenceCountry) return
    setError('')
    try {
      await call(`/admin/users/${encodeURIComponent(card.did)}/residence`, { method: 'PUT', body: JSON.stringify({ country: residence[0], ticket: ticketRef.trim() || undefined }) })
      setDone(`Страна резидентства: ${countryLabel(residence[0])}`)
      await open(card.did)
      void search(q)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось')
    }
  }

  const send = async () => {
    if (!card) return
    setError('')
    try {
      await call(`/admin/users/${encodeURIComponent(card.did)}/messages`, { method: 'POST', body: JSON.stringify({ subject: subject.trim(), text: text.trim() }) })
      setSubject('')
      setText('')
      setDone('Сообщение отправлено — пользователь увидит его в «Моих обращениях» и уведомлениях')
      await open(card.did)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось')
    }
  }

  if (!token) {
    return (
      <div className="mx-auto max-w-[520px] px-5 py-20">
        <h1 className="text-3xl font-extrabold tracking-tight">Пользователи</h1>
        {staffAuthConfigured ? (
          <button type="button" onClick={() => void staffLogin('/admin/users')} className="btn-primary mt-6 w-full !py-2.5">
            <ShieldCheck size={15} aria-hidden="true" /> Войти через {SITE_NAME}
          </button>
        ) : (
          <p className="mt-4 text-sm text-muted-foreground">Вход сотрудников не настроен (VITE_ZITADEL_*).</p>
        )}
      </div>
    )
  }

  const input = 'w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

  return (
    <div className="mx-auto max-w-[1100px] px-5 pb-24 md:px-8">
      <div className="flex flex-wrap items-end justify-between gap-4 pt-10">
        <div>
          <p className="meta">Админка · поддержка</p>
          <h1 className="mt-2 text-4xl font-extrabold tracking-tight">Пользователи</h1>
        </div>
        <div className="flex gap-2">
          <Link to="/admin/tickets" className="btn-ghost !px-3 !py-2 !text-[11px]">Обращения</Link>
          <Link to="/admin/email" className="btn-ghost !px-3 !py-2 !text-[11px]">Почта</Link>
          <Link to="/admin/payouts" className="btn-ghost !px-3 !py-2 !text-[11px]">Выплаты</Link>
          <Link to="/admin/finance" className="btn-ghost !px-3 !py-2 !text-[11px]">Финансы</Link>
          <Link to="/admin/labels" className="btn-ghost !px-3 !py-2 !text-[11px]">Метки</Link>
          <Link to="/admin/system" className="btn-ghost !px-3 !py-2 !text-[11px]">Системные</Link>
          <Link to="/admin/claims" className="btn-ghost !px-3 !py-2 !text-[11px]">Заявки на авторство</Link>
        </div>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault()
          void search(q)
        }}
        className="mt-6 flex max-w-[520px] gap-2"
      >
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="часть handle, имени или DID" aria-label="Поиск пользователя" className={input} />
        <button type="submit" className="btn-ghost shrink-0 !px-3 !py-2"><Search size={14} aria-hidden="true" /> Найти</button>
        <label className="flex shrink-0 items-center gap-1.5 text-sm">
          <input type="checkbox" checked={onlyService} onChange={(e) => setOnlyService(e.target.checked)} /> Служебные
        </label>
      </form>
      {error && <p role="alert" className="mt-4 border border-destructive/60 bg-destructive/5 p-3 text-sm">{error}</p>}
      {done && <p role="status" className="mt-4 text-sm text-accent">{done}</p>}

      <div className="mt-6 grid gap-6 lg:grid-cols-[340px_1fr]">
        <ul className="divide-y divide-border border border-border">
          {rows.length === 0 && <li className="p-4 text-sm text-muted-foreground">Никого не нашли.</li>}
          {rows.map((u) => (
            <li key={u.did}>
              <button type="button" onClick={() => void open(u.did)} className={`w-full cursor-pointer p-3 text-left text-sm hover:bg-secondary/60 ${card?.did === u.did ? 'bg-secondary/60' : ''}`}>
                <span className="font-semibold">@{u.handle}</span>
                {u.tier === 'premium' && <span className="meta ml-2 text-accent">premium</span>}
                {u.service && <span className="meta ml-2">служебная · {({ labeler: 'коллегия', crawler: 'краулер', system: 'системная' } as Record<string, string>)[u.service] ?? u.service}</span>}
                <span className="meta block !normal-case tracking-normal">{countryLabel(u.residenceCountry)} · с {when(u.createdAt)}</span>
              </button>
            </li>
          ))}
        </ul>

        {card ? (
          <section aria-label="Пользователь" className="border border-border p-5">
            <h2 className="text-xl font-extrabold tracking-tight">{card.displayName ?? card.handle}</h2>
            <p className="meta mt-1 !normal-case tracking-normal">
              @{card.handle} · <code className="font-mono">{card.did}</code> · {card.tier === 'premium' ? 'Premium' : 'бесплатный'} · с {when(card.createdAt)}
            </p>
            <p className="mt-2 text-sm">
              <Link to={`/profile/${card.handle}`} className="text-accent hover:underline">Профиль на сайте</Link>
            </p>

            <h3 className="mt-6 text-sm font-semibold">Тариф</h3>
            <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
              <input value={tierReason} onChange={(e) => setTierReason(e.target.value)} placeholder="причина: оплата прошла, подписка не включилась…" aria-label="Причина смены тарифа" className={input} />
              {card.tier === 'premium' ? (
                <button type="button" onClick={() => void changeTier('free')} className="btn-ghost !px-3 !py-2">Снять Premium</button>
              ) : (
                <button type="button" onClick={() => void changeTier('premium')} className="btn-primary !px-3 !py-2">Выдать Premium</button>
              )}
            </div>
            <p className="meta mt-1 !normal-case tracking-normal">только роль admin; причина пишется в аудит</p>

            <h3 className="mt-6 text-sm font-semibold">Страны · <Link to="/legal/register-and-residency" className="font-normal text-accent hover:underline">в чём разница</Link></h3>
            <p className="mt-2 text-sm">Регистрация: <b>{countryLabel(card.signupCountry)}</b> <span className="text-muted-foreground">— не меняется</span></p>
            <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_160px_auto] sm:items-end">
              <div className="grid gap-1 text-sm">
                Резидентство
                <CountrySelect label="Страна резидентства" placeholder="Страна" value={residence} onChange={setResidence} />
              </div>
              <input value={ticketRef} onChange={(e) => setTicketRef(e.target.value)} placeholder="№ заявки, tk_…" aria-label="Номер заявки" className={input} />
              <button type="button" onClick={() => void changeResidence()} disabled={!residence[0] || residence[0] === card.residenceCountry} className="btn-primary !px-3 !py-2">
                Сменить
              </button>
            </div>
            <p className="meta mt-1 !normal-case tracking-normal">смена — после проверки документа по заявке; пишется в аудит</p>

            <h3 className="mt-6 text-sm font-semibold">Устройства</h3>
            <DevicesList
              key={card.did}
              load={() => call<DeviceSession[]>(`/admin/users/${encodeURIComponent(card.did)}/sessions`)}
              revoke={(id) => call(`/admin/users/${encodeURIComponent(card.did)}/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' })}
              revokeAll={() => call(`/admin/users/${encodeURIComponent(card.did)}/sessions/revoke-all`, { method: 'POST' })}
              revokeAllLabel="Завершить все сессии пользователя"
            />
            <p className="meta mt-1 !normal-case tracking-normal">завершение пишется в аудит; пользователю придётся войти снова</p>

            <h3 className="mt-6 text-sm font-semibold">Обращения · {card.tickets.length}</h3>
            {card.tickets.length === 0 ? (
              <p className="mt-1 text-sm text-muted-foreground">Обращений из аккаунта нет.</p>
            ) : (
              <ul className="mt-1 text-sm">
                {card.tickets.map((t) => (
                  <li key={t.id} className="flex flex-wrap justify-between gap-2 border-b border-border/70 py-1.5 last:border-b-0">
                    <span>{t.subject}</span>
                    <span className="meta">{t.id} · {TICKET_STATUS[t.status] ?? t.status}</span>
                  </li>
                ))}
              </ul>
            )}

            <h3 className="mt-6 text-sm font-semibold">Написать пользователю</h3>
            <div className="mt-2 grid gap-2">
              <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Тема" aria-label="Тема" className={input} maxLength={200} />
              <textarea value={text} onChange={(e) => setText(e.target.value)} rows={4} placeholder="Сообщение" aria-label="Сообщение" className={input} />
              <button type="button" onClick={() => void send()} disabled={subject.trim().length < 3 || !text.trim()} className="btn-primary w-fit !px-4 !py-2">
                Отправить
              </button>
              <p className="meta !normal-case tracking-normal">придёт в «Мои обращения» и уведомления; пользователь сможет ответить</p>
            </div>
          </section>
        ) : (
          <p className="text-sm text-muted-foreground">Выберите пользователя слева.</p>
        )}
      </div>
    </div>
  )
}
