import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import { CheckCircle2, Clock, XCircle } from 'lucide-react'
import { payments, type Purchase } from '@/lib/api'
import { safeReturnTo } from '@/lib/safeUrl'

/**
 * Возврат с оплаты lava.top. Статус из адреса не учитываем — его можно подделать:
 * ждём, пока сервер получит вебхук и подтвердит счёт.
 */
export default function PurchaseReturnPage() {
  const { orderId = '' } = useParams()
  const [params] = useSearchParams()
  const returnTo = safeReturnTo(params.get('returnTo'))
  const navigate = useNavigate()
  const [order, setOrder] = useState<Purchase | null>(null)
  const [error, setError] = useState('')
  const [timedOut, setTimedOut] = useState(false)

  useEffect(() => {
    let alive = true
    let tries = 0
    const tick = async () => {
      try {
        const o = await payments.status(orderId)
        if (!alive) return
        setOrder(o)
        if (o.status === 'paid') {
          setTimeout(() => navigate(returnTo, { replace: true }), 1500)
          return
        }
        if (o.status !== 'pending') return
      } catch (err) {
        if (alive) setError(err instanceof Error ? err.message : 'Не удалось проверить заказ')
        return
      }
      // вебхук обычно приходит за секунды; ждём до 2 минут
      if (++tries < 60) setTimeout(tick, 2000)
      else setTimedOut(true)
    }
    tick()
    return () => {
      alive = false
    }
  }, [orderId, returnTo, navigate])

  const status = order?.status
  return (
    <div className="mx-auto max-w-[560px] px-5 py-24 text-center" role="status" aria-live="polite">
      {status === 'paid' ? (
        <>
          <CheckCircle2 size={28} className="mx-auto text-accent" aria-hidden="true" />
          <h1 className="mt-4 text-3xl font-extrabold tracking-tight">Оплата прошла</h1>
          <p className="mt-3 text-muted-foreground">Доступ открыт, возвращаем вас к статье…</p>
        </>
      ) : status === 'failed' || error ? (
        <>
          <XCircle size={28} className="mx-auto text-destructive" aria-hidden="true" />
          <h1 className="mt-4 text-3xl font-extrabold tracking-tight">Оплата не прошла</h1>
          <p className="mt-3 text-muted-foreground">{error || 'Деньги не списаны. Можно попробовать ещё раз.'}</p>
        </>
      ) : (
        <>
          <Clock size={28} className="mx-auto text-accent" aria-hidden="true" />
          <h1 className="mt-4 text-3xl font-extrabold tracking-tight">Ждём подтверждение оплаты</h1>
          <p className="mt-3 text-muted-foreground">
            {timedOut
              ? 'Подтверждение задерживается. Доступ откроется автоматически, как только платёж пройдёт — страницу можно закрыть.'
              : 'Обычно это занимает несколько секунд.'}
          </p>
        </>
      )}
      <Link to={returnTo} className="btn-ghost mt-8">К статье</Link>
    </div>
  )
}
