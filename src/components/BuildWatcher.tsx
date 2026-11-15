import { useEffect, useRef } from 'react'
import { useLocation } from 'react-router'
import { checkForNewBuild, hasNewBuild } from '@/lib/chunkReload'

/**
 * Вышла новая сборка сайта — при следующем переходе страница загружается заново (адрес уже новый,
 * ничего не теряется). Сама проверка — не чаще раза в 5 минут (lib/chunkReload).
 */
export default function BuildWatcher() {
  const { pathname } = useLocation()
  const first = useRef(true)
  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    if (hasNewBuild()) window.location.reload()
    else void checkForNewBuild()
  }, [pathname])
  return null
}
