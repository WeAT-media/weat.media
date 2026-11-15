import { fetchArticleBody } from '@/lib/remoteFeed'

/**
 * Предзагрузка по прогнозу ForesightJS: код страницы и данные начинают грузиться
 * до клика. Повторные вызовы ничего не делают.
 */
const done = new Set<string>()

const routes: [RegExp, () => Promise<unknown>][] = [
  [/^\/article\//, () => import('@/pages/ArticlePage')],
  [/^\/profile\//, () => import('@/pages/ProfilePage')],
  [/^\/case\//, () => import('@/pages/CasePage')],
  [/^\/premium/, () => import('@/pages/PremiumPage')],
  [/^\/atmosphere/, () => import('@/pages/AtmospherePage')],
  [/^\/compose/, () => import('@/pages/ComposePage')],
]

export function prefetchRoute(path: string) {
  const r = routes.find(([re]) => re.test(path))
  if (!r || done.has(r[0].source)) return
  done.add(r[0].source)
  void r[1]().catch(() => done.delete(r[0].source))
}

/** статья из ленты: код страницы + её текст (лента приходит без текстов) */
export function prefetchArticle(id: string, atUri?: string, bodyPending?: boolean) {
  prefetchRoute(`/article/${id}`)
  if (atUri && bodyPending) void fetchArticleBody(atUri)
}
