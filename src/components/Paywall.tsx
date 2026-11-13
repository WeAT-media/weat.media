import { useState } from 'react'
import { Check, Lock } from 'lucide-react'
import { useLocation, useNavigate } from 'react-router'
import { hasSession, payments } from '@/lib/api'
import type { Article } from '@/types/types'
import { useStore } from '@/lib/store'
import { SITE_NAME } from '@/config/site'
import { formatMoney } from '@/lib/money'

/**
 * Пейволл платной статьи. Политика платформы: 90% — автору, 10% — комиссия
 * на инфраструктуру. Статья с закрытой частью на площадке (privateContentId) покупается
 * через lava.top; у демо-записей клик открывает доступ локально.
 */
export default function Paywall({ article, unlocked, onUnlock }: { article: Article; unlocked: boolean; onUnlock: () => void }) {
  const { tiers, prefs } = useStore()
  const pw = article.paywall
  const isSubscription = pw?.accessType === 'subscription'
  const tier = isSubscription ? tiers.find((t) => t.id === pw?.tierId) : undefined
  const title = isSubscription ? (pw?.tierName ?? tier?.name ?? 'Подписка') : null
  // цена в валюте автора; читатель с другой валютой видит пометку (пересчёта по курсу пока нет)
  const currency = pw?.currency ?? tier?.currency ?? 'RUB'
  const price = formatMoney(pw?.price ?? 0, currency)
  const period = isSubscription || pw?.period === 'month' ? '/мес' : ' разово'
  const foreign = currency !== prefs.currency
  const real = !!pw?.privateContentId && !isSubscription
  const navigate = useNavigate()
  const location = useLocation()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const buy = async (method?: 'CARD' | 'SBP') => {
    if (!real) return onUnlock()
    if (!hasSession()) return navigate(`/login?returnTo=${encodeURIComponent(location.pathname)}`)
    setBusy(true)
    setError('')
    try {
      const { orderId, paymentUrl } = await payments.buy(pw!.privateContentId!, location.pathname, method)
      if (paymentUrl) window.location.assign(paymentUrl)
      else navigate(`/purchase/${orderId}?returnTo=${encodeURIComponent(location.pathname)}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось создать счёт')
      setBusy(false)
    }
  }

  return (
    <div className="my-8 border-2 border-accent/60 bg-secondary/70 p-7">
      <div className="flex flex-wrap items-center gap-3">
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-accent text-accent-foreground">
          <Lock size={16} aria-hidden="true" />
        </span>
        <div>
          <p className="meta text-accent">{isSubscription ? 'Подписка на тир' : 'Платный контент'}</p>
          <p className="text-lg font-extrabold tracking-tight">
            {title ? `${title} · ` : ''}{price}{period} · {article.author.name}
          </p>
          {foreign && <p className="meta mt-1 !normal-case tracking-normal">цена в валюте автора ({currency}); списание по курсу вашей карты</p>}
          {isSubscription && tier?.description && (
            <p className="mt-1 text-sm text-muted-foreground">{tier.description}</p>
          )}
        </div>
      </div>

      {/* визуализация сплита 90/10 */}
      <div className="mt-6" role="img" aria-label="90 процентов автору, 10 процентов — комиссия площадки">
        <div className="flex h-3 w-full overflow-hidden rounded-sm">
          <div className="h-full bg-accent" style={{ width: '90%' }} />
          <div className="h-full bg-primary" style={{ width: '10%' }} />
        </div>
        <div className="mt-2 flex flex-wrap justify-between gap-x-6 gap-y-1">
          <span className="meta">90% — автору</span>
          <span className="meta">10% — инфраструктура {SITE_NAME}</span>
        </div>
      </div>

      <p className="mt-5 max-w-[60ch] text-sm leading-relaxed text-muted-foreground">
        Подписка идёт напрямую автору — платформа удерживает фиксированные 10% на хостинг, relay и
        хранение репозиториев. Отмена в любой момент, доступ остаётся до конца периода.
      </p>

      {unlocked ? (
        <p className="mt-6 inline-flex items-center gap-2 font-mono text-[13px] font-semibold uppercase tracking-[0.06em] text-accent">
          <Check size={15} aria-hidden="true" /> Доступ открыт — приятного чтения
        </p>
      ) : (
        <div className="mt-6">
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => buy()} disabled={busy} className="btn-primary">
              {busy ? 'Создаём счёт…' : isSubscription ? `Оформить подписку — ${price}/мес` : `Оформить доступ — ${price}`}
            </button>
            {real && currency === 'RUB' && (
              <button type="button" onClick={() => buy('SBP')} disabled={busy} className="btn-ghost">
                Оплатить по СБП
              </button>
            )}
          </div>
          {real && <p className="meta mt-2 !normal-case tracking-normal">безопасная оплата · карты РФ, СБП, зарубежные карты и PayPal</p>}
          {error && <p role="alert" className="mt-2 text-sm text-destructive">{error}</p>}
        </div>
      )}
    </div>
  )
}
