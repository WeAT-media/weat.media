import { lazy, type ComponentType } from 'react'

/**
 * После деплоя у открытой вкладки старая сборка: её куски страниц (assets/*-<hash>.js) на сервере уже
 * заменены новыми, import() падает — и без этого экран оставался белым до ручной перезагрузки.
 * Перезагружаем страницу один раз (не чаще раза в 30 с — не зациклиться, если сервер правда лежит).
 */
const KEY = 'weat:chunk-reload'

export function reloadForNewBuild(): boolean {
  try {
    const last = Number(sessionStorage.getItem(KEY) ?? 0)
    if (Date.now() - last < 30_000) return false
    sessionStorage.setItem(KEY, String(Date.now()))
  } catch {
    /* sessionStorage недоступен — всё равно пробуем один раз */
  }
  window.location.reload()
  return true
}

/** React.lazy с перезагрузкой на новую сборку, если кусок страницы не загрузился */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function lazyPage<T extends ComponentType<any>>(load: () => Promise<{ default: T }>) {
  return lazy(() =>
    load().catch((err: unknown) => {
      // пока страница перезагружается — не показываем ошибку
      if (reloadForNewBuild()) return new Promise<{ default: T }>(() => {})
      throw err
    }),
  )
}

// Vite: не загрузились зависимости куска (modulepreload) — то же самое
if (typeof window !== 'undefined') {
  window.addEventListener('vite:preloadError', (e) => {
    if (reloadForNewBuild()) e.preventDefault()
  })
}
