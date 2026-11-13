import FeeNote from '@/components/FeeNote'
import { useEffect, useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router'
import { Archive, ArchiveRestore, ArrowLeft, BadgeCheck, Clock3, Landmark, Pencil, Plus, Trash2, TrendingUp, Unplug, Wallet } from 'lucide-react'
import { useStore } from '@/lib/store'
import { formatMoney, type Currency } from '@/lib/money'
import { payouts as payoutsApi, type Earnings } from '@/lib/api'
import Reveal from '@/components/Reveal'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import type { SubscriptionTier } from '@/types/types'

const tierField =
  'w-full rounded-md border border-input bg-background px-3 py-2 text-[14px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

/** суммы с сервера — в минимальных единицах валюты */
const money = (minor: number, currency: Currency) => formatMoney(minor / 100, currency)
const when = (iso: string) => new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' })
const PAYOUT_STATUS: Record<Earnings['payouts'][number]['status'], string> = { requested: 'на рассмотрении', paid: 'выплачено', rejected: 'отклонено' }

const PAYOUT_COUNTRIES: { code: string; label: string }[] = [
  { code: 'RU', label: 'Россия' },
  { code: 'KZ', label: 'Казахстан' },
  { code: 'GE', label: 'Грузия' },
  { code: 'RS', label: 'Сербия' },
  { code: 'AM', label: 'Армения' },
  { code: 'other', label: 'Другая страна' },
]

/** Допустимые пары актив → сети: неправильную пару выбрать нельзя */
const CRYPTO_NETWORKS: Record<string, string[]> = {
  USDT: ['TRC20', 'ERC20', 'TON'],
  TON: ['TON'],
  BTC: ['Bitcoin'],
  ETH: ['ERC20'],
}

const ADDRESS_HINTS: Record<string, string> = {
  TRC20: 'адрес начинается с «T», 34 символа',
  ERC20: 'адрес вида 0x + 40 hex-символов',
  TON: '48 символов base64url (EQ…/UQ…)',
  Bitcoin: '26–62 символа, начинается с 1/3/bc1',
}

/** Базовая проверка публичного адреса по сети (без контрольных сумм) */
function validateCryptoAddress(network: string, address: string): boolean {
  const a = address.trim()
  switch (network) {
    case 'ERC20':
      return /^0x[0-9a-fA-F]{40}$/.test(a)
    case 'TRC20':
      return /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(a)
    case 'TON':
      return /^[EU]Q[0-9A-Za-z_-]{46}$/.test(a)
    case 'Bitcoin':
      return /^(bc1[02-9ac-hj-np-z]{11,71}|[13][1-9A-HJ-NP-Za-km-z]{25,34})$/.test(a)
    default:
      return a.length >= 26 && a.length <= 64
  }
}

/**
 * Выплаты автору: баланс и продажи — с сервера (заказы lava.top), вывод — заявка, которую
 * проводит площадка. Реквизиты для заявки хранятся на сервере зашифрованными.
 */
export default function PayoutsSettingsPage() {
  const {
    payoutConnected, setPayoutConnected, setPayoutDetails, tiers, saveTier, deleteTier,
    payoutCountry, payoutMethod, payoutAsset, payoutNetwork, cryptoAddress,
  } = useStore()
  const [searchParams] = useSearchParams()
  const rawReturnTo = searchParams.get('returnTo')
  const returnTo = rawReturnTo && rawReturnTo.startsWith('/') ? rawReturnTo : null
  const [account, setAccount] = useState('')
  const [earnings, setEarnings] = useState<Earnings | null>(null)
  const [earningsError, setEarningsError] = useState('')
  const [withdraw, setWithdraw] = useState<{ currency: Currency; destination: string } | null>(null)
  const [withdrawError, setWithdrawError] = useState('')
  const [withdrawBusy, setWithdrawBusy] = useState(false)
  const loadEarnings = () =>
    payoutsApi.earnings().then(setEarnings, (e: Error) => setEarningsError(e.message))
  useEffect(() => {
    void loadEarnings()
  }, [])
  const [error, setError] = useState('')
  const [networkConfirmed, setNetworkConfirmed] = useState(false)
  const isRu = payoutCountry === 'RU'
  // РФ: крипто-выплаты юридически недоступны — только фиат
  const effectiveMethod = isRu ? 'fiat' : payoutMethod

  const changeCountry = (country: string) => {
    if (country === 'RU' && payoutMethod === 'crypto') {
      // смена резидентства на РФ при крипто-методе: выплаты отключаются и тарифы
      // деактивируются (см. fieldset ниже), но реквизиты и тарифы не удаляются
      setPayoutConnected(false)
      setPayoutDetails({ payoutCountry: country, payoutMethod: 'fiat' })
      setError('')
      return
    }
    setPayoutDetails({ payoutCountry: country })
  }

  const changeAsset = (asset: string) => {
    setPayoutDetails({ payoutAsset: asset, payoutNetwork: CRYPTO_NETWORKS[asset][0] })
    setNetworkConfirmed(false)
  }

  const validAddress = validateCryptoAddress(payoutNetwork, cryptoAddress)

  const connect = (e: FormEvent) => {
    e.preventDefault()
    if (effectiveMethod === 'fiat') {
      if (account.trim().length < 8) {
        setError('Укажите реквизиты — минимум 8 символов.')
        return
      }
    } else {
      if (!cryptoAddress.trim()) {
        setError('Укажите публичный адрес кошелька для выплат.')
        return
      }
      if (!validAddress) {
        setError(`Адрес не похож на ${payoutNetwork}: ${ADDRESS_HINTS[payoutNetwork]}.`)
        return
      }
      if (!networkConfirmed) {
        setError('Подтвердите, что сеть выбрана верно — отправка не в ту сеть необратима.')
        return
      }
    }
    setPayoutConnected(true)
    setError('')
  }
  const [editingTier, setEditingTier] = useState<SubscriptionTier | null>(null)
  const [tierName, setTierName] = useState('')
  const [tierPrice, setTierPrice] = useState('')
  const [tierDesc, setTierDesc] = useState('')
  const [tierError, setTierError] = useState('')

  const submitTier = (e: FormEvent) => {
    e.preventDefault()
    const price = Number(tierPrice)
    if (tierName.trim().length < 3) {
      setTierError('Название короткое — минимум 3 символа.')
      return
    }
    if (!Number.isFinite(price) || price < 1) {
      setTierError('Месячная цена должна быть больше нуля.')
      return
    }
    saveTier({
      id: editingTier?.id ?? `tier-${Date.now()}`,
      name: tierName.trim(),
      priceMonthly: Math.round(price),
      description: tierDesc.trim(),
      archived: editingTier?.archived ?? false,
    })
    setEditingTier(null)
    setTierName('')
    setTierPrice('')
    setTierDesc('')
    setTierError('')
  }

  const startEdit = (t: SubscriptionTier) => {
    setEditingTier(t)
    setTierName(t.name)
    setTierPrice(String(t.priceMonthly))
    setTierDesc(t.description)
    setTierError('')
  }

  return (
    <Reveal className="border border-border p-6">
      <section aria-label="Выплаты автору">
        <h2 className="font-mono text-[13px] font-bold uppercase tracking-[0.12em]">Выплаты</h2>
        <p className="mt-3 max-w-[58ch] text-sm leading-relaxed text-muted-foreground">
          Платные публикации доступны автору только после подключения выплат: 90%* каждой продажи (у Premium-автора —
          99%*) уходит на эти реквизиты. Читатели платят через lava.top, выплаты по заявке проводит площадка.
        </p>
        <FeeNote className="mt-1" />

        {payoutConnected ? (
          <div className="mt-6">
            <p className="inline-flex items-center gap-2 border border-accent/60 bg-secondary/60 px-4 py-3 text-[15px]">
              <BadgeCheck size={15} className="text-accent" aria-hidden="true" />
              Выплаты подключены
              {effectiveMethod === 'crypto'
                ? ` · крипта: ${payoutAsset} (${payoutNetwork}), ${cryptoAddress.slice(0, 6)}…`
                : ` · фиат${account ? `, •••• ${account.replace(/\s+/g, '').slice(-4)}` : ''}`}
            </p>
            <div className="mt-4 flex flex-wrap gap-3">
              {returnTo && (
                <Link to={returnTo} className="btn-primary !px-4 !py-2">
                  <ArrowLeft size={13} aria-hidden="true" /> Вернуться к редактору
                </Link>
              )}
              <button
                onClick={() => {
                  // отключение не удаляет реквизиты и тарифы — они просто неактивны
                  setPayoutConnected(false)
                  setAccount('')
                }}
                className="btn-ghost !px-4 !py-2"
              >
                <Unplug size={13} aria-hidden="true" /> Отключить
              </button>
            </div>
            <div className="mt-6 max-w-md">
              <label htmlFor="payout-country" className="meta">Страна резидентства</label>
              <select
                id="payout-country"
                value={payoutCountry}
                onChange={(e) => changeCountry(e.target.value)}
                className="mt-2 w-full cursor-pointer rounded-md border border-input bg-background px-3 py-2 font-mono text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {PAYOUT_COUNTRIES.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.label}
                  </option>
                ))}
              </select>
              {isRu && (
                <p className="meta mt-2 !normal-case tracking-normal text-muted-foreground">
                  резидентам РФ крипто-выплаты недоступны (законодательные ограничения) — только фиат
                </p>
              )}
            </div>
          </div>
        ) : (
          <form onSubmit={connect} noValidate className="mt-6 space-y-4">
            <div>
              <label htmlFor="payout-country" className="meta">Страна резидентства</label>
              <select
                id="payout-country"
                value={payoutCountry}
                onChange={(e) => changeCountry(e.target.value)}
                className="mt-2 w-full cursor-pointer rounded-md border border-input bg-background px-3 py-2 font-mono text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {PAYOUT_COUNTRIES.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <span className="meta">Способ выплат</span>
              <div className="mt-2 flex flex-wrap gap-2" role="radiogroup" aria-label="Способ выплат">
                <button
                  type="button"
                  role="radio"
                  aria-checked={effectiveMethod === 'fiat'}
                  onClick={() => setPayoutDetails({ payoutMethod: 'fiat' })}
                  className={`cursor-pointer rounded-full border px-4 py-1.5 font-mono text-[12px] font-semibold uppercase tracking-[0.05em] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                    effectiveMethod === 'fiat'
                      ? 'border-accent bg-accent text-accent-foreground'
                      : 'border-border text-foreground hover:border-accent hover:text-accent'
                  }`}
                >
                  Фиат (карта/счёт)
                </button>
                <button
                  type="button"
                  role="radio"
                  aria-checked={effectiveMethod === 'crypto'}
                  disabled={isRu}
                  onClick={() => setPayoutDetails({ payoutMethod: 'crypto' })}
                  className={`rounded-full border px-4 py-1.5 font-mono text-[12px] font-semibold uppercase tracking-[0.05em] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                    isRu
                      ? 'cursor-not-allowed border-border text-muted-foreground opacity-60'
                      : effectiveMethod === 'crypto'
                        ? 'cursor-pointer border-accent bg-accent text-accent-foreground'
                        : 'cursor-pointer border-border text-foreground hover:border-accent hover:text-accent'
                  }`}
                >
                  Крипта
                </button>
              </div>
              {isRu ? (
                <p className="meta mt-2 !normal-case tracking-normal text-muted-foreground">
                  крипто-выплаты недоступны резидентам РФ: закон ограничивает расчёты в криптовалюте — выберите
                  фиат или укажите другую страну резидентства
                </p>
              ) : (
                effectiveMethod === 'crypto' && (
                  <p className="meta mt-2 !normal-case tracking-normal text-muted-foreground">
                    мы никогда не просим seed-фразу или приватные ключи — нужен только публичный адрес.
                    Никогда не вводите их ни на этой, ни на любой другой странице
                  </p>
                )
              )}
            </div>

            {effectiveMethod === 'fiat' ? (
              <>
                <div>
                  <label htmlFor="payout-account" className="meta">Реквизиты</label>
                  <input
                    id="payout-account"
                    value={account}
                    onChange={(e) => {
                      setAccount(e.target.value)
                      if (error) setError('')
                    }}
                    placeholder="Номер карты, счёт или IBAN"
                    className="mt-2 w-full rounded-md border border-input bg-background px-4 py-2.5 font-mono text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                </div>
              </>
            ) : (
              <>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label htmlFor="payout-asset" className="meta">Актив</label>
                    <select
                      id="payout-asset"
                      value={payoutAsset}
                      onChange={(e) => changeAsset(e.target.value)}
                      className="mt-2 w-full cursor-pointer rounded-md border border-input bg-background px-3 py-2 font-mono text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {Object.keys(CRYPTO_NETWORKS).map((a) => (
                        <option key={a} value={a}>
                          {a}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label htmlFor="payout-network" className="meta">Сеть</label>
                    <select
                      id="payout-network"
                      value={payoutNetwork}
                      onChange={(e) => {
                        setPayoutDetails({ payoutNetwork: e.target.value })
                        setNetworkConfirmed(false)
                      }}
                      className="mt-2 w-full cursor-pointer rounded-md border border-input bg-background px-3 py-2 font-mono text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {CRYPTO_NETWORKS[payoutAsset].map((n) => (
                        <option key={n} value={n}>
                          {n}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div>
                  <label htmlFor="crypto-address" className="meta">Публичный адрес кошелька</label>
                  <input
                    id="crypto-address"
                    value={cryptoAddress}
                    onChange={(e) => {
                      setPayoutDetails({ cryptoAddress: e.target.value })
                      if (error) setError('')
                    }}
                    placeholder={ADDRESS_HINTS[payoutNetwork]}
                    className="mt-2 w-full rounded-md border border-input bg-background px-4 py-2.5 font-mono text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                  {cryptoAddress.trim() && !validAddress && (
                    <p className="mt-2 text-sm text-destructive">
                      Не похоже на адрес {payoutNetwork}: {ADDRESS_HINTS[payoutNetwork]}.
                    </p>
                  )}
                </div>
                <label className="flex cursor-pointer items-start gap-2.5 text-sm leading-relaxed">
                  <input
                    type="checkbox"
                    checked={networkConfirmed}
                    onChange={(e) => {
                      setNetworkConfirmed(e.target.checked)
                      if (error) setError('')
                    }}
                    className="mt-0.5"
                  />
                  Подтверждаю: выплаты пойдут в сети {payoutNetwork}; отправка не в ту сеть необратима
                </label>
              </>
            )}

            {error && <p className="text-sm text-destructive">{error}</p>}
            <button type="submit" className="btn-primary !px-4 !py-2">
              <Landmark size={13} aria-hidden="true" /> Подключить выплаты
            </button>
          </form>
        )}
      </section>

      {/* Баланс автора — по реальным продажам; вывод — заявка на всю доступную сумму валюты */}
      <section aria-label="Баланс автора" className="rule mt-10 pt-8">
        <h2 className="font-mono text-[13px] font-bold uppercase tracking-[0.12em]">Баланс</h2>
        {earningsError && <p role="alert" className="mt-4 text-sm text-destructive">{earningsError}</p>}
        {!earnings && !earningsError && <p className="mt-4 text-sm text-muted-foreground">Загружаем…</p>}
        {earnings && earnings.balances.length === 0 && (
          <p className="mt-4 text-sm text-muted-foreground">Продаж пока нет. Здесь появятся деньги за платные статьи.</p>
        )}
        {earnings?.balances.map((b) => (
          <div key={b.currency} className="mt-5">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {(
                [
                  { label: 'Доступно к выводу', value: b.available, icon: Wallet },
                  { label: `Ожидает · ${earnings.holdDays} дней после оплаты`, value: b.pending + b.reserved, icon: Clock3 },
                  { label: 'Всего заработано', value: b.earned, icon: TrendingUp },
                ] as const
              ).map((s) => (
                <div key={s.label} className="border border-border bg-secondary/40 p-4">
                  <p className="flex items-center gap-2.5 text-xl font-extrabold tracking-tight">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent" aria-hidden="true">
                      <s.icon size={14} />
                    </span>
                    {money(s.value, b.currency)}
                  </p>
                  <p className="meta mt-1.5">{s.label}</p>
                </div>
              ))}
            </div>
            <div className="mt-4">
              <button
                type="button"
                disabled={!payoutConnected || b.available < b.minPayout}
                onClick={() => {
                  setWithdrawError('')
                  setWithdraw({ currency: b.currency, destination: effectiveMethod === 'crypto' ? `${payoutAsset} ${payoutNetwork} ${cryptoAddress}` : account })
                }}
                className="btn-primary !px-4 !py-2 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Wallet size={13} aria-hidden="true" /> Вывести {money(b.available, b.currency)}
              </button>
              <p className="meta mt-2 !normal-case tracking-normal text-muted-foreground">
                {!payoutConnected
                  ? 'вывод недоступен: подключите выплаты выше — баланс при этом сохраняется'
                  : b.available < b.minPayout
                    ? `минимальная выплата — ${money(b.minPayout, b.currency)}`
                    : 'заявку проверит и проведёт площадка; сумма резервируется сразу'}
              </p>
            </div>
          </div>
        ))}

        <Dialog open={!!withdraw} onOpenChange={(o) => !o && setWithdraw(null)}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Заявка на выплату</DialogTitle>
              <DialogDescription>
                Выплатим всю доступную сумму на эти реквизиты. Проверьте их: перевод на неверные реквизиты не вернуть.
              </DialogDescription>
            </DialogHeader>
            {withdraw && (
              <form
                onSubmit={async (e) => {
                  e.preventDefault()
                  setWithdrawBusy(true)
                  setWithdrawError('')
                  try {
                    await payoutsApi.request({ currency: withdraw.currency, method: effectiveMethod, destination: withdraw.destination })
                    setWithdraw(null)
                    await loadEarnings()
                  } catch (err) {
                    setWithdrawError(err instanceof Error ? err.message : 'Не удалось создать заявку')
                  } finally {
                    setWithdrawBusy(false)
                  }
                }}
                className="space-y-3"
              >
                <label htmlFor="withdraw-dest" className="meta">{effectiveMethod === 'crypto' ? 'Актив, сеть и адрес' : 'Карта, счёт или IBAN'}</label>
                <input
                  id="withdraw-dest"
                  required
                  minLength={8}
                  value={withdraw.destination}
                  onChange={(e) => setWithdraw({ ...withdraw, destination: e.target.value })}
                  className={tierField}
                />
                {withdrawError && <p className="text-sm text-destructive">{withdrawError}</p>}
                <button type="submit" disabled={withdrawBusy} className="btn-primary !px-4 !py-2">
                  {withdrawBusy ? 'Отправляем…' : 'Отправить заявку'}
                </button>
              </form>
            )}
          </DialogContent>
        </Dialog>

        {earnings && earnings.payouts.length > 0 && (
          <div className="mt-6">
            <p className="meta mb-2">Заявки на выплату</p>
            <ul className="space-y-2">
              {earnings.payouts.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 border border-border bg-background px-4 py-2.5">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">
                      {money(p.amount, p.currency)} · {p.destinationHint}
                    </p>
                    <p className="meta !normal-case tracking-normal text-muted-foreground">
                      {when(p.createdAt)} · {PAYOUT_STATUS[p.status]}
                      {p.staffNote && ` — ${p.staffNote}`}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}

        {earnings && earnings.sales.length > 0 && (
          <div className="mt-6">
            <p className="meta mb-2">Последние продажи</p>
            <ul className="space-y-2">
              {earnings.sales.map((op) => (
                <li key={op.orderId} className="flex flex-wrap items-center justify-between gap-2 border border-border bg-background px-4 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{op.title}</p>
                    <p className="meta !normal-case tracking-normal text-muted-foreground">{when(op.paidAt)} · покупка статьи</p>
                  </div>
                  <p className="font-mono text-sm font-semibold">
                    +{money(op.authorShare, op.currency)}* <span className="meta text-muted-foreground">из {money(op.amount, op.currency)}</span>
                  </p>
                </li>
              ))}
            </ul>
            <FeeNote className="mt-2" />
          </div>
        )}
      </section>

      {/* Тарифные уровни месячной подписки — локальный демо-CRUD */}
      <section aria-label="Тарифы подписки" className="rule mt-10 pt-8">
        <h2 className="font-mono text-[13px] font-bold uppercase tracking-[0.12em]">Тарифы подписки</h2>
        <p className="mt-3 max-w-[58ch] text-sm leading-relaxed text-muted-foreground">
          Уровни, которые читатель выбирает при подписке на платный контент. Демо: хранится локально,
          биллинга нет.
        </p>

        {!payoutConnected && (
          <div className="mt-5 border border-dashed border-border bg-secondary/50 p-4">
            <p className="meta inline-flex items-center gap-1.5">
              <Unplug size={12} aria-hidden="true" /> Провайдер выплат отключён
            </p>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              Тарифы сохранены, но неактивны: их нельзя редактировать, архивировать или выбирать для платных
              записей, пока выплаты не подключены. После повторного подключения управление вернётся — ничего
              удалять не нужно.
            </p>
            <button
              type="button"
              onClick={() => document.getElementById('payout-account')?.focus()}
              className="btn-primary mt-4 !px-4 !py-2"
            >
              <Landmark size={13} aria-hidden="true" /> Подключить выплаты
            </button>
          </div>
        )}

        <fieldset
          disabled={!payoutConnected}
          aria-disabled={!payoutConnected}
          className={!payoutConnected ? 'opacity-60 saturate-50' : undefined}
        >
        <div className="mt-5 space-y-3">
          {tiers.length === 0 && (
            <p className="text-sm text-muted-foreground">Тарифов пока нет — добавьте первый ниже.</p>
          )}
          {tiers.map((t) => (
            <div
              key={t.id}
              className={`flex flex-wrap items-center justify-between gap-3 border p-4 ${
                t.archived ? 'border-dashed border-border opacity-60' : 'border-border bg-secondary/40'
              }`}
            >
              <div className="min-w-0">
                <p className="font-semibold">
                  {t.name}{' '}
                  <span className="meta ml-2">
                    {formatMoney(t.priceMonthly, t.currency ?? 'RUB')}/мес
                    {t.archived ? ' · архив' : ''}
                    {!payoutConnected ? ' · неактивен: выплаты отключены' : ''}
                  </span>
                </p>
                {t.description && <p className="mt-1 text-sm text-muted-foreground">{t.description}</p>}
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => startEdit(t)}
                  title="Изменить"
                  aria-label={`Изменить тариф ${t.name}`}
                  className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-full border border-border transition-colors hover:border-accent hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <Pencil size={12} aria-hidden="true" />
                </button>
                <button
                  onClick={() => saveTier({ ...t, archived: !t.archived })}
                  title={t.archived ? 'Вернуть из архива' : 'В архив'}
                  aria-label={`${t.archived ? 'Вернуть из архива' : 'Архивировать'} тариф ${t.name}`}
                  className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-full border border-border transition-colors hover:border-accent hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {t.archived ? <ArchiveRestore size={12} aria-hidden="true" /> : <Archive size={12} aria-hidden="true" />}
                </button>
                <button
                  onClick={() => deleteTier(t.id)}
                  title="Удалить"
                  aria-label={`Удалить тариф ${t.name}`}
                  className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-full border border-border transition-colors hover:border-destructive hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <Trash2 size={12} aria-hidden="true" />
                </button>
              </div>
            </div>
          ))}
        </div>

        <form onSubmit={submitTier} noValidate className="mt-5 border border-border bg-background p-4">
          <p className="meta inline-flex items-center gap-1.5">
            <Plus size={12} aria-hidden="true" /> {editingTier ? 'Изменить тариф' : 'Новый тариф'}
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_130px]">
            <input
              value={tierName}
              onChange={(e) => setTierName(e.target.value)}
              placeholder="Название: Подписчик"
              aria-label="Название тарифа"
              className={tierField}
            />
            <input
              value={tierPrice}
              onChange={(e) => setTierPrice(e.target.value)}
              type="number"
              min="1"
              placeholder="₽/мес"
              aria-label="Месячная цена"
              className={`${tierField} font-mono`}
            />
          </div>
          <input
            value={tierDesc}
            onChange={(e) => setTierDesc(e.target.value)}
            placeholder="Преимущества (необязательно)"
            aria-label="Описание тарифа"
            className={`${tierField} mt-3`}
          />
          {tierError && <p className="mt-2 text-sm text-destructive">{tierError}</p>}
          <div className="mt-3 flex gap-2">
            <button type="submit" className="btn-primary !px-4 !py-2">
              {editingTier ? 'Сохранить' : 'Добавить тариф'}
            </button>
            {editingTier && (
              <button
                type="button"
                onClick={() => {
                  setEditingTier(null)
                  setTierName('')
                  setTierPrice('')
                  setTierDesc('')
                  setTierError('')
                }}
                className="btn-ghost !px-4 !py-2"
              >
                Отмена
              </button>
            )}
          </div>
        </form>
        </fieldset>
      </section>
    </Reveal>
  )
}
