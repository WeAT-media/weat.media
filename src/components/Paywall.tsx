import { useEffect, useState } from 'react'
import { Check, Lock } from 'lucide-react'
import { useLocation, useNavigate } from 'react-router'
import { api, hasSession, payments } from '@/lib/api'
import type { Article } from '@/types/types'
import { useStore } from '@/lib/store'
import { SITE_NAME } from '@/config/site'
import { formatMoney } from '@/lib/money'
import FeeNote from '@/components/FeeNote'

/**
 * Пейволл платной статьи. Доля автора — как считает сервер (server/src/lava.ts): 90% обычно,
 * 99% у Premium-автора; остальное — инфраструктура площадки. Статья с закрытой частью на площадке (privateContentId) покупается
 * через lava.top; у демо-записей клик открывает доступ локально.
 */
export default function Paywall({ article, unlocked, onUnlock }: { article: Article; unlocked: boolean; onUnlock: () => void }) {
  const { tiers, prefs, user } = useStore()
  const own = !!user && user.handle === article.author.handle
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
  // тариф автора — с сервера: от него зависит доля (у демо-автора без аккаунта — обычная)
  const [authorPremium, setAuthorPremium] = useState(false)
  const authorHandle = article.author.handle
  useEffect(() => {
    let alive = true
    api.user(authorHandle).then((u) => alive && setAuthorPremium(u.tier === 'premium'), () => {})
    return () => {
      alive = false
    }
  }, [authorHandle])
  const share = authorPremium ? 99 : 90

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

      {/* сплит: у Premium-автора 99/1, иначе 90/10 */}
      <div className="mt-6" role="img" aria-label={`${share} процентов автору, ${100 - share} — комиссия площадки`}>
        <div className="flex h-3 w-full overflow-hidden rounded-sm">
          <div className="h-full bg-accent" style={{ width: `${share}%` }} />
          <div className="h-full bg-primary" style={{ width: `${100 - share}%` }} />
        </div>
        <div className="mt-2 flex flex-wrap justify-between gap-x-6 gap-y-1">
          <span className="meta">
            {share}%* — автору{authorPremium && ' · Premium-автор'}
          </span>
          <span className="meta">{100 - share}% — инфраструктура {SITE_NAME}</span>
        </div>
      </div>

      <FeeNote className="mt-1" />

      <p className="mt-5 max-w-[60ch] text-sm leading-relaxed text-muted-foreground">
        {isSubscription
          ? `Подписка идёт напрямую автору — площадка удерживает ${100 - share}% на хостинг, relay и хранение репозиториев. Отмена в любой момент, доступ остаётся до конца периода.`
          : `Оплата идёт автору — площадка удерживает ${100 - share}% на хостинг, relay и хранение репозиториев. Доступ — навсегда.`}
      </p>

      {unlocked ? (
        <p className="mt-6 inline-flex items-center gap-2 font-mono text-[13px] font-semibold uppercase tracking-[0.06em] text-accent">
          <Check size={15} aria-hidden="true" /> {own ? 'Это ваша статья — читателям текст откроется после оплаты' : 'Доступ открыт — приятного чтения'}
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
