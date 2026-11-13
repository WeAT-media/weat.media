import type { Article, CaseFile, Comment } from '@/types/types'
import { SITE_NAME } from '@/config/site'

/** Минимальный снимок статистики дела (соответствует caseStats из store) */
export interface CaseFeedStats {
  guilty: number
  clear: number
  voted: number
  closed: boolean
  outcome: 'guilty' | 'clear' | null
}

/** XML-экранирование значений RSS */
export function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/** '2026-11-09 14:22' / ISO → RFC 822 для pubDate */
export function toRssDate(dateStr: string): string {
  const d = new Date(dateStr.replace(' ', 'T'))
  return Number.isNaN(d.getTime()) ? new Date().toUTCString() : d.toUTCString()
}

function itemXml({ title, link, guid, pubDate, description }: { title: string; link: string; guid: string; pubDate: string; description: string }): string {
  return [
    '  <item>',
    `    <title>${escapeXml(title)}</title>`,
    `    <link>${escapeXml(link)}</link>`,
    `    <guid isPermaLink="true">${escapeXml(guid)}</guid>`,
    `    <pubDate>${toRssDate(pubDate)}</pubDate>`,
    `    <description>${escapeXml(description)}</description>`,
    '  </item>',
  ].join('\n')
}

function channelXml({ title, link, description, items }: { title: string; link: string; description: string; items: string[] }): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0">',
    '<channel>',
    `  <title>${escapeXml(title)}</title>`,
    `  <link>${escapeXml(link)}</link>`,
    `  <description>${escapeXml(description)}</description>`,
    `  <language>ru</language>`,
    `  <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>`,
    `<generator>${SITE_NAME}</generator>`,
    ...items,
    '</channel>',
    '</rss>',
    '',
  ].join('\n')
}

/** RSS 2.0 со статьями автора; ссылки абсолютные по текущему origin */
export function buildAuthorFeed(authorName: string, handle: string, articles: Article[], origin: string): string {
  const items = articles.map((a) =>
    itemXml({
      title: a.title,
      link: `${origin}/article/${a.id}`,
      guid: `${origin}/article/${a.id}`,
      pubDate: a.publishedAt,
      description: a.excerpt,
    }),
  )
  return channelXml({
    title: `${SITE_NAME} — ${authorName}`,
    link: `${origin}/profile/${handle}`,
    description: `Записи @${handle} на ${SITE_NAME}`,
    items,
  })
}

/** RSS 2.0 с комментариями статьи (включая ответы) */
export function buildCommentsFeed(article: Article, comments: Comment[], origin: string): string {
  const items = comments.map((c) =>
    itemXml({
      title: `@${c.author}: ${c.text.slice(0, 80)}${c.text.length > 80 ? '…' : ''}`,
      link: `${origin}/article/${article.id}#comment-${c.id}`,
      guid: `${origin}/article/${article.id}#comment-${c.id}`,
      pubDate: c.at,
      description: c.parentId ? `Ответ в треде: ${c.text}` : c.text,
    }),
  )
  return channelXml({
    title: `Комментарии: ${article.title}`,
    link: `${origin}/article/${article.id}`,
    description: `Тред комментариев к записи на ${SITE_NAME}`,
    items,
  })
}

/** RSS 2.0 по судебному делу: открытие, кворум, ход голосования, вердикт.
 *  Честный снимок состояния на момент клика (как остальные ленты прототипа);
 *  ссылки и GUID абсолютные по текущему origin, значения экранированы. */
export function buildCaseFeed(
  caseFile: CaseFile,
  article: Article | undefined,
  stats: CaseFeedStats,
  origin: string,
): string {
  const caseUrl = `${origin}/case/${caseFile.id}`
  const items: string[] = [
    itemXml({
      title: `${caseFile.number}: дело открыто`,
      link: caseUrl,
      guid: `${caseUrl}#opened`,
      pubDate: caseFile.openedAt,
      description: `Принята жалоба: ${caseFile.charges} Предмет: ${caseFile.articleTitle}.`,
    }),
    itemXml({
      title: `${caseFile.number}: кворум ${stats.voted >= caseFile.quorum ? 'достигнут' : 'не достигнут'} (${stats.voted}/${caseFile.jurorsTotal}, нужно ${caseFile.quorum})`,
      link: caseUrl,
      guid: `${caseUrl}#quorum`,
      pubDate: caseFile.openedAt,
      description: `Прогресс кворума: проголосовало ${stats.voted} из ${caseFile.jurorsTotal} присяжных при кворуме ${caseFile.quorum}.`,
    }),
    itemXml({
      title: `${caseFile.number}: голосование — виновна ${stats.guilty}, невиновна ${stats.clear}`,
      link: caseUrl,
      guid: `${caseUrl}#votes`,
      pubDate: caseFile.openedAt,
      description: `Текущий расклад голосов коллегии (с учётом весов): «виновна» — ${stats.guilty}, «невиновна» — ${stats.clear}.`,
    }),
  ]
  if (stats.closed && stats.outcome) {
    items.push(
      itemXml({
        title: `${caseFile.number}: вердикт — ${stats.outcome === 'guilty' ? 'метка выдана' : 'оправдано'}`,
        link: caseUrl,
        guid: `${caseUrl}#verdict`,
        pubDate: caseFile.openedAt,
        description:
          stats.outcome === 'guilty'
            ? `Коллегия признала запись нарушающей. Метка действует только на подписчиков коллегии; статья остаётся у автора${article ? `: ${article.title}` : '.'}`
            : 'Коллегия признала нарушение недоказанным. Метка не выдана.',
      }),
    )
  }
  return channelXml({
    title: `${SITE_NAME} — ${caseFile.number}`,
    link: caseUrl,
    description: `Ход разбирательства ${caseFile.number}: ${caseFile.articleTitle}`,
    items,
  })
}

/** Скачать XML как файл (Blob); object URL сразу отзываем */
export function downloadXml(filename: string, xml: string): void {
  const blob = new Blob([xml], { type: 'application/rss+xml' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
