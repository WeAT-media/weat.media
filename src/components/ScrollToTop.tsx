import { useEffect } from 'react'
import { useLocation, useNavigationType } from 'react-router'

/**
 * Новая страница открывается сверху. «Назад/вперёд» (POP) не трогаем — позицию
 * восстанавливает браузер; ссылки с #якорем прокручивает сам браузер/страница.
 */
export default function ScrollToTop() {
  const { pathname, hash } = useLocation()
  const navType = useNavigationType()

  useEffect(() => {
    if (navType === 'POP' || hash) return
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' })
  }, [pathname, hash, navType])

  return null
}
