import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { CONSENT_EVENT, getConsent, isEuVisitor, setConsent } from '@/lib/consent'

/** Баннер согласия — только для ЕЭЗ, Великобритании и Швейцарии и только пока посетитель не выбрал */
export default function CookieBanner() {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    let alive = true
    // Баннер — после первого действия посетителя: иначе он, появляясь после загрузки JS, становится LCP страницы.
    // До выбора статистика всё равно не считается, так что ожидание ничего не нарушает.
    const interactions = ['pointerdown', 'keydown', 'scroll', 'touchstart'] as const
    const onInteract = () => {
      stopWaiting()
      isEuVisitor().then((eu) => alive && eu && setOpen(true))
    }
    const stopWaiting = () => interactions.forEach((type) => window.removeEventListener(type, onInteract))
    if (!getConsent()) interactions.forEach((type) => window.addEventListener(type, onInteract, { passive: true }))
    const onEvent = (e: Event) => setOpen((e as CustomEvent).detail === 'reopen')
    window.addEventListener(CONSENT_EVENT, onEvent)
    return () => {
      alive = false
      stopWaiting()
      window.removeEventListener(CONSENT_EVENT, onEvent)
    }
  }, [])
  if (!open) return null

  return (
    <div role="dialog" aria-modal="false" aria-label="Cookie и статистика" aria-describedby="cookie-description" className="fixed inset-x-3 bottom-3 z-50 mx-auto max-w-[720px] border border-border bg-background p-5 shadow-xs md:inset-x-6">
      <p id="cookie-description" className="text-sm leading-relaxed">
        Мы используем только необходимое хранилище браузера: вход, настройки, история. Рекламных cookie нет. С вашего
        разрешения считаем статистику просмотров, включая псевдонимную canvas-сигнатуру графического окружения,
        и запоминаем, по какой ссылке вы пришли (UTM).{' '}
        <Link to="/legal/cookies" className="text-accent underline underline-offset-2">Подробнее</Link>
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
