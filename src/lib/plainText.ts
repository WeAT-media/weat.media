/**
 * Текст без markdown — для тизеров (лента, черновики, превью): ссылки и упоминания → их текст,
 * без маркеров списков, заголовков, цитат, выделения, фенсов и HTML-сущностей.
 */
export function plainExcerpt(md: string, max = 300): string {
  const t = md
    .replace(/```[\s\S]*?(```|$)/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s{0,3}>\s?/gm, '')
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+/gm, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x([0-9a-f]+);/gi, (_m, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_m, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&(amp|lt|gt|quot|nbsp);/g, (_m, e: string) => ({ amp: '&', lt: '<', gt: '>', quot: '"', nbsp: ' ' })[e]!)
    .replace(/(\*\*|__|~~|`)/g, '')
    .replace(/(^|\s)[*_](\S[^*_]*\S|\S)[*_](?=\s|$|[.,!?;:])/g, '$1$2')
    .replace(/\s+/g, ' ')
    .trim()
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t
}
