import { useEffect, useRef, type ReactNode } from 'react'

/** Появление блока при входе во вьюпорт (только opacity/translate, уважает reduced-motion через CSS) */
export default function Reveal({ children, className = '' }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.classList.add('is-visible')
    // Нет IO (старый браузер) — просто показываем
    if (!('IntersectionObserver' in window)) {
      el.classList.add('is-visible')
      return
    }
    // Уже полностью выше вьюпорта (смена шага/страницы при прокрутке) — IO его не «увидит» никогда
    if (el.getBoundingClientRect().bottom <= 0) {
      el.classList.add('is-visible')
      return
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            e.target.classList.add('is-visible')
            io.unobserve(e.target)
          }
        }
      },
      { threshold: 0.08 },
    )
    io.observe(el)
    // Страховка: контент не должен зависеть от срабатывания анимации/наблюдателя
    const t = setTimeout(() => el.classList.add('is-visible'), 1200)
    return () => {
      io.disconnect()
      clearTimeout(t)
    }
  }, [])

  return (
    <div ref={ref} className={`reveal ${className}`}>
      {children}
    </div>
  )
}
