import { useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router'
import { Archive, ArchiveRestore, ArrowLeft, BadgeCheck, Clock3, Landmark, Pencil, Plus, Trash2, TrendingUp, Unplug, Wallet } from 'lucide-react'
import { useStore } from '@/lib/store'
import { formatMoney } from '@/lib/money'
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

const fmtRub = (n: number) => `${n.toLocaleString('ru-RU')} ₽`

/** Демо-баланс автора: фиксированные суммы, никакого реального биллинга */
const DEMO_BALANCE = {
  available: 12_340,
  pending: 2_180,
  total: 47_915,
}

/** Демо-операции: источник и доля автора (90% разовые продажи, 99% Premium-подписка) */
const DEMO_OPERATIONS: { label: string; detail: string; gross: number; net: number; at: string }[] = [
  { label: 'Продажа статьи «Firehose без магии»', detail: 'разовая покупка · автору 90%', gross: 490, net: 441, at: '2026-11-11' },
  { label: 'Подписка «Подписчик» · @alina-v.bsky.social', detail: 'premium-подписка · автору 99%', gross: 299, net: 296, at: '2026-11-10' },
  { label: 'Продажа видео «AppView, который не падает»', detail: 'разовая покупка · автору 90%', gross: 990, net: 891, at: '2026-11-08' },
  { label: 'Подписка «Патрон» · @loschin.io', detail: 'premium-подписка · автору 99%', gross: 999, net: 989, at: '2026-11-05' },
]

/** Демо-оценка эквивалента (₽ за единицу актива): не курс и не обещание обмена */
const DEMO_RATES: Record<string, number> = { USDT: 92, TON: 540, BTC: 9_100_000, ETH: 310_000 }

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

/** Базовая демо-валидация публичного адреса по сети (без контрольных сумм) */
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
 * Подключение выплат — локальный демо-мок: реквизиты «сохраняются» в localStorage-флаг,
 * никаких платёжных провайдеров и списаний.
 */
export default function PayoutsSettingsPage() {
  const {
    payoutConnected, setPayoutConnected, setPayoutDetails, tiers, saveTier, deleteTier,
    payoutCountry, payoutMethod, payoutAsset, payoutNetwork, cryptoAddress,
  } = useStore()
  const [searchParams] = useSearchParams()
  const rawReturnTo = searchParams.get('returnTo')
  const returnTo = rawReturnTo && rawReturnTo.startsWith('/') ? rawReturnTo : null
  const [provider, setProvider] = useState('demo-bank')
  const [account, setAccount] = useState('')
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
        setError('Укажите реквизиты — минимум 8 символов (в демо проверка формальная).')
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
  const [withdrawOpen, setWithdrawOpen] = useState(false)

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
          Платные публикации доступны автору только после подключения выплат: 90% каждой продажи уходит
          на эти реквизиты. Демо-прототип: подключение — это локальная отметка, платежей и провайдеров нет.
        </p>

        {payoutConnected ? (
          <div className="mt-6">
            <p className="inline-flex items-center gap-2 border border-accent/60 bg-secondary/60 px-4 py-3 text-[15px]">
              <BadgeCheck size={15} className="text-accent" aria-hidden="true" />
              Выплаты подключены
              {effectiveMethod === 'crypto'
                ? ` · крипта: ${payoutAsset} (${payoutNetwork}), ${cryptoAddress.slice(0, 6)}…`
                : ` · фиат${account ? `, ${provider}, ${account.slice(0, 4)}…` : ''}`}
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
                    демо: мы никогда не просим seed-фразу или приватные ключи — нужен только публичный адрес.
                    Никогда не вводите их ни на этой, ни на любой другой странице
                  </p>
                )
              )}
            </div>

            {effectiveMethod === 'fiat' ? (
              <>
                <div>
                  <label htmlFor="payout-provider" className="meta">Провайдер (демо)</label>
                  <select
                    id="payout-provider"
                    value={provider}
                    onChange={(e) => setProvider(e.target.value)}
                    className="mt-2 w-full cursor-pointer rounded-md border border-input bg-background px-3 py-2 font-mono text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <option value="demo-bank">Демо-банк</option>
                    <option value="yookassa-demo">ЮKassa (демо)</option>
                    <option value="sbp-demo">СБП (демо)</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="payout-account" className="meta">Реквизиты</label>
                  <input
                    id="payout-account"
                    value={account}
                    onChange={(e) => {
                      setAccount(e.target.value)
                      if (error) setError('')
                    }}
                    placeholder="Карта или счёт — никуда не отправляется"
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

      {/* Баланс автора — демо-суммы, виден и при отключённом провайдере;
          вывод средств недоступен до подключения выплат и не имитирует транзакцию */}
      <section aria-label="Баланс автора" className="rule mt-10 pt-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-mono text-[13px] font-bold uppercase tracking-[0.12em]">Баланс</h2>
          <p className="meta">
            обновлено {new Date().toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })} · демо, не банк
          </p>
        </div>

        <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
          {(
            [
              { label: 'Доступно к выводу', value: DEMO_BALANCE.available, icon: Wallet },
              { label: 'Ожидает зачисления', value: DEMO_BALANCE.pending, icon: Clock3 },
              { label: 'Всего заработано', value: DEMO_BALANCE.total, icon: TrendingUp },
            ] as const
          ).map((s) => (
            <div key={s.label} className="border border-border bg-secondary/40 p-4">
              <p className="flex items-center gap-2.5 text-xl font-extrabold tracking-tight">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent" aria-hidden="true">
                  <s.icon size={14} />
                </span>
                {fmtRub(s.value)}
              </p>
              <p className="meta mt-1.5">{s.label}</p>
            </div>
          ))}
        </div>

        {!isRu && payoutMethod === 'crypto' && (
          <p className="meta mt-3 !normal-case tracking-normal text-muted-foreground">
            демо-эквивалент доступного: ≈{' '}
            {(DEMO_BALANCE.available / (DEMO_RATES[payoutAsset] ?? 1)).toLocaleString('ru-RU', { maximumFractionDigits: 2 })}{' '}
            {payoutAsset} — ориентировочная оценка без точного курса; это не предложение обмена и не котировка
          </p>
        )}

        <div className="mt-4">
          <button
            type="button"
            disabled={!payoutConnected}
            onClick={() => setWithdrawOpen(true)}
            className="btn-primary !px-4 !py-2 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Wallet size={13} aria-hidden="true" /> Вывести {fmtRub(DEMO_BALANCE.available)}
          </button>
          {!payoutConnected && (
            <p className="meta mt-2 !normal-case tracking-normal text-muted-foreground">
              вывод недоступен: провайдер выплат отключён — подключите выплаты выше, баланс при этом сохраняется
            </p>
          )}
        </div>

        <Dialog open={withdrawOpen} onOpenChange={setWithdrawOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Вывод средств (демо)</DialogTitle>
              <DialogDescription>
                Это прототип: реальной транзакции не происходит, деньги никуда не уходят. В боевой версии здесь
                был бы вывод {fmtRub(DEMO_BALANCE.available)} на подключённые реквизиты.
              </DialogDescription>
            </DialogHeader>
            <button type="button" onClick={() => setWithdrawOpen(false)} className="btn-primary !px-4 !py-2">
              Понятно
            </button>
          </DialogContent>
        </Dialog>

        <div className="mt-6">
          <p className="meta mb-2">Последние начисления</p>
          <ul className="space-y-2">
            {DEMO_OPERATIONS.map((op) => (
              <li
                key={`${op.label}-${op.at}`}
                className="flex flex-wrap items-center justify-between gap-2 border border-border bg-background px-4 py-2.5"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{op.label}</p>
                  <p className="meta !normal-case tracking-normal text-muted-foreground">
                    {op.at} · {op.detail}
                  </p>
                </div>
                <p className="font-mono text-sm font-semibold">
                  +{fmtRub(op.net)} <span className="meta text-muted-foreground">из {fmtRub(op.gross)}</span>
                </p>
              </li>
            ))}
          </ul>
        </div>
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
