import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { CONSENT_EVENT, getConsent, isEuVisitor, setConsent } from '@/lib/consent'

/** Баннер согласия — только для ЕЭЗ, Великобритании и Швейцарии и только пока посетитель не выбрал */
export default function CookieBanner() {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    let alive = true
    if (!getConsent()) isEuVisitor().then((eu) => alive && eu && setOpen(true))
    const onEvent = (e: Event) => setOpen((e as CustomEvent).detail === 'reopen')
    window.addEventListener(CONSENT_EVENT, onEvent)
    return () => {
      alive = false
      window.removeEventListener(CONSENT_EVENT, onEvent)
    }
  }, [])
  if (!open) return null

  return (
    <div role="dialog" aria-label="Cookie и статистика" className="fixed inset-x-3 bottom-3 z-50 mx-auto max-w-[720px] border border-border bg-background p-5 shadow-xs md:inset-x-6">
      <p className="text-sm leading-relaxed">
        Мы используем только необходимое хранилище браузера: вход, настройки, история. Рекламных cookie нет. С вашего
        разрешения считаем анонимную статистику просмотров и запоминаем, по какой ссылке вы пришли (UTM).{' '}
        <Link to="/legal/cookies" className="text-accent hover:underline">Подробнее</Link>
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" onClick={() => setConsent('analytics')} className="btn-primary !px-4 !py-2">
          Разрешить статистику
        </button>
        <button type="button" onClick={() => setConsent('necessary')} className="btn-ghost !px-4 !py-2">
          Только необходимые
        </button>
      </div>
    </div>
  )
}
