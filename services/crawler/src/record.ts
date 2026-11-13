import type { Extracted } from './extract.js'

export const ARTICLE_COLLECTION = 'media.weat.article'

/** Запись lexicons/media.weat.article.json из извлечённой статьи */
export function articleRecord(a: Extracted, now = new Date()) {
  const lang = a.lang && /^[a-z]{2}(-[A-Za-z]{2})?$/.test(a.lang) ? a.lang : null
  return {
    $type: ARTICLE_COLLECTION,
    title: a.title.slice(0, 300),
    text: a.markdown,
    excerpt: a.excerpt.slice(0, 500),
    tags: a.tags.map((t) => t.slice(0, 64)).slice(0, 20),
    ...(lang ? { langs: [lang] } : {}),
    ...(a.cover && /^https?:\/\//.test(a.cover) ? { cover: a.cover } : {}),
    createdAt: now.toISOString(),
    source: {
      url: a.url,
      site: a.site,
      ...(a.author ? { author: a.author.slice(0, 256) } : {}),
      ...(a.authorUrl ? { authorUrl: a.authorUrl } : {}),
      ...(a.publishedAt ? { publishedAt: a.publishedAt } : {}),
      crawledAt: now.toISOString(),
    },
  }
}
