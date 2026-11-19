import type { ComponentType } from 'react'

type Loader = () => Promise<ComponentType>

/** Публичные страницы без данных AppView: рендерятся на сервере ради быстрого первого кадра. */
export const staticPages: { path: RegExp; key: string; load: Loader; title?: string }[] = [
  { path: /^\/atmosphere$/, key: 'Atmosphere', load: () => import('@/pages/AtmospherePage').then((m) => m.default) },
  { path: /^\/premium$/, key: 'Premium', load: () => import('@/pages/PremiumPage').then((m) => m.default) },
  { path: /^\/collections$/, key: 'Collections', load: () => import('@/pages/CollectionsPages').then((m) => m.CollectionsPage) },
  { path: /^\/cases$/, key: 'Cases', load: () => import('@/pages/CasesPage').then((m) => m.default) },
  { path: /^\/api$/, key: 'ApiDocs', load: () => import('@/pages/ApiDocsPage').then((m) => m.default) },
  { path: /^\/docs$/, key: 'Docs', load: () => import('@/pages/DocsPage').then((m) => m.default) },
  { path: /^\/ads$/, key: 'Ads', load: () => import('@/pages/AdsPage').then((m) => m.default) },
  { path: /^\/crawler$/, key: 'Crawler', load: () => import('@/pages/CrawlerInfoPage').then((m) => m.default) },
  { path: /^\/support$/, key: 'Support', load: () => import('@/pages/SupportPage').then((m) => m.default) },
  { path: /^\/support\/contact$/, key: 'SupportContact', load: () => import('@/pages/SupportContactPage').then((m) => m.default) },
  { path: /^\/support\/legal$/, key: 'SupportLegal', load: () => import('@/pages/SupportLegalPage').then((m) => m.default) },
  { path: /^\/legal$/, key: 'LegalIndex', load: () => import('@/pages/legal/LegalPages').then((m) => m.LegalIndexPage) },
  { path: /^\/legal\/[^/]+$/, key: 'LegalDoc', load: () => import('@/pages/legal/LegalPages').then((m) => m.LegalDocPage) },
  { path: /^\/login$/, key: 'Login', load: () => import('@/pages/LoginPage').then((m) => m.default) },
]

export async function staticPage(pathname: string): Promise<Record<string, ComponentType>> {
  const page = staticPages.find((p) => p.path.test(pathname))
  return page ? { [page.key]: await page.load() } : {}
}
