import { useEffect } from 'react'
import { useLocation } from 'react-router'
import { SITE_NAME, SITE_URL } from '@/config/site'
import { useStore } from '@/lib/store'

const pages: Record<string, { title: string; description: string }> = {
  '/': { title: `${SITE_NAME} — независимое медиа для авторов и читателей`, description: 'Публикуйте статьи и видео, получайте до 99% с продаж и сохраняйте аудиторию благодаря открытому AT Protocol.' },
  '/feed': { title: 'Лента публикаций', description: 'Новые статьи и видео независимых авторов: фильтры по темам, языку и формату, без рекламного алгоритма.' },
  '/hot': { title: 'Горячее', description: 'Самые обсуждаемые и заметные публикации независимых авторов.' },
  '/collections': { title: 'Подборки публикаций', description: 'Тематические подборки статей и видео от авторов сообщества.' },
  '/cases': { title: 'Открытый суд присяжных', description: 'Публичные разбирательства спорных публикаций: голоса, доказательства, вердикты и апелляции.' },
  '/atmosphere': { title: 'Что такое AT Protocol и ATmosphere', description: 'Простое объяснение открытого протокола: DID, PDS, Relay, перенос аккаунта и независимая модерация.' },
  '/premium': { title: 'Premium для авторов', description: 'Расширенные блоки, аналитика, отсутствие рекламы и 99% с продаж автору.' },
  '/docs': { title: 'Документация', description: `Документация ${SITE_NAME}: публикации, формат статей, протокол и возможности платформы.` },
  '/api': { title: 'API для разработчиков', description: `Открытый API ${SITE_NAME}: публикации, профили, комментарии и интеграции.` },
  '/support': { title: 'Поддержка', description: `Ответы на вопросы о ${SITE_NAME}, помощь авторам и читателям.` },
  '/legal': { title: 'Правовая информация', description: `Условия использования, конфиденциальность и правовые документы ${SITE_NAME}.` },
}

function setMeta(selector: string, attribute: 'name' | 'property', key: string, content: string) {
  let node = document.head.querySelector<HTMLMetaElement>(selector)
  if (!node) {
    node = document.createElement('meta')
    node.setAttribute(attribute, key)
    document.head.appendChild(node)
  }
  node.content = content
}

export default function SeoManager() {
  const { pathname } = useLocation()
  const { articles } = useStore()
  const articleId = pathname.startsWith('/article/') ? pathname.split('/')[2] : undefined
  const profileHandle = pathname.startsWith('/profile/') && !pathname.includes('/settings') ? pathname.split('/')[2] : undefined
  const article = articleId ? articles.find((a) => a.id === articleId) : undefined
  const author = profileHandle ? articles.find((a) => a.author.handle === profileHandle)?.author : undefined
  const staticPage = pages[pathname]

  useEffect(() => {
    const title = article ? `${article.title} — ${SITE_NAME}` : author ? `${author.name} (@${author.handle}) — ${SITE_NAME}` : staticPage ? `${staticPage.title} — ${SITE_NAME}` : `${SITE_NAME} — свободное медиа`
    const description = article ? (article.subtitle || article.excerpt).slice(0, 300) : author ? `Публикации ${author.name} (@${author.handle}) в ${SITE_NAME}.` : staticPage?.description ?? `Публикации и открытое сообщество ${SITE_NAME}.`
    const canonical = `${SITE_URL}${pathname}`
    const privatePage = /^\/(admin|login|auth|compose|shared-draft|purchase|after-payments)/.test(pathname) || pathname.includes('/settings') || pathname === '/ads/dashboard' || pathname === '/support/tickets'
    const knownPage = !!staticPage || /^\/(article|collection|case|profile|legal|support|design|ads|crawler)(\/|$)/.test(pathname)
    const missingArticle = !!articleId && !article
    const robots = privatePage || article?.noindex || missingArticle || !knownPage ? 'noindex, nofollow' : 'index, follow, max-image-preview:large'

    document.title = title
    document.documentElement.lang = article?.language ?? 'ru'
    setMeta('meta[name="description"]', 'name', 'description', description)
    setMeta('meta[name="robots"]', 'name', 'robots', robots)
    setMeta('meta[property="og:title"]', 'property', 'og:title', title)
    setMeta('meta[property="og:description"]', 'property', 'og:description', description)
    setMeta('meta[property="og:url"]', 'property', 'og:url', canonical)
    setMeta('meta[property="og:type"]', 'property', 'og:type', article ? 'article' : 'website')
    setMeta('meta[property="og:image"]', 'property', 'og:image', article?.fromIndex ? `${SITE_URL}/api/og/article/${encodeURIComponent(article.id)}.png` : `${SITE_URL}/og-image.png`)
    setMeta('meta[name="twitter:title"]', 'name', 'twitter:title', title)
    setMeta('meta[name="twitter:description"]', 'name', 'twitter:description', description)
    setMeta('meta[name="twitter:image"]', 'name', 'twitter:image', article?.fromIndex ? `${SITE_URL}/api/og/article/${encodeURIComponent(article.id)}.png` : `${SITE_URL}/og-image.png`)
    let link = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]')
    if (!link) {
      link = document.createElement('link')
      link.rel = 'canonical'
      document.head.appendChild(link)
    }
    link.href = canonical

    const structured = article ? {
      '@context': 'https://schema.org', '@type': 'BlogPosting', mainEntityOfPage: canonical, headline: article.title,
      description, datePublished: article.publishedAtFull ?? article.publishedAt, inLanguage: article.language ?? 'ru',
      image: [`${SITE_URL}/api/og/article/${encodeURIComponent(article.id)}.png`], keywords: article.tags.join(', '),
      author: { '@type': 'Person', name: article.author.name, url: `${SITE_URL}/profile/${article.author.handle}` },
      publisher: { '@type': 'Organization', name: SITE_NAME, url: SITE_URL },
    } : author ? {
      '@context': 'https://schema.org', '@type': 'ProfilePage', mainEntity: { '@type': 'Person', name: author.name, alternateName: `@${author.handle}`, identifier: author.did, url: canonical },
    } : {
      '@context': 'https://schema.org', '@graph': [
        { '@type': 'Organization', '@id': `${SITE_URL}/#organization`, name: SITE_NAME, url: SITE_URL },
        { '@type': 'WebSite', '@id': `${SITE_URL}/#website`, name: SITE_NAME, url: SITE_URL, description, publisher: { '@id': `${SITE_URL}/#organization` } },
        ...(staticPage && pathname !== '/' ? [{ '@type': 'WebPage', name: staticPage.title, url: canonical, description, isPartOf: { '@id': `${SITE_URL}/#website` } }] : []),
      ],
    }
    let script = document.getElementById('page-structured-data')
    if (!script) {
      script = document.createElement('script')
      script.id = 'page-structured-data'
      script.setAttribute('type', 'application/ld+json')
      document.head.appendChild(script)
    }
    script.textContent = JSON.stringify(structured).replace(/</g, '\\u003c')
  }, [pathname, staticPage, article, author, articleId])

  return null
}
