import type { AppPages } from '@/App'

export async function clientPages(pathname: string): Promise<Partial<AppPages>> {
  if (pathname === '/') return import('@/pages/LandingPage').then((m) => ({ Landing: m.default }))
  if (pathname === '/feed') return import('@/pages/Feed').then((m) => ({ Feed: m.default }))
  if (pathname === '/hot') return import('@/pages/HotPage').then((m) => ({ Hot: m.default }))
  if (/^\/article\/[^/]+$/.test(pathname)) return import('@/pages/ArticlePage').then((m) => ({ Article: m.default }))
  if (/^\/profile\/[^/]+$/.test(pathname)) return import('@/pages/ProfilePage').then((m) => ({ Profile: m.default }))
  return {}
}
