import type { ArticleBlock } from '@/types/types'

export interface TocItem {
  /** устойчивый slug с дедупликацией (-2, -3…) — одинаковый для markdown и блоков */
  id: string
  /** plain-текст заголовка без markdown-разметки */
  text: string
  /** индекс блока в массиве (для tocFromBlocks) */
  index?: number
}

/** Убирает inline-markdown: **жирный**, *курсив*, [текст](url), `код` */
export function plainHeadingText(raw: string): string {
  return raw
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .trim()
}

/** slug из plain-текста: unicode-буквы/цифры, пробелы → дефисы */
export function slugifyHeading(text: string): string {
  const slug = text
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
  return slug || 'section'
}

function dedup(base: string, used: Set<string>): string {
  let id = base
  let n = 2
  while (used.has(id)) id = `${base}-${n++}`
  used.add(id)
  return id
}

/** TOC из markdown тела: строки ##/### (h1 — это title страницы, в TOC не входит) */
export function tocFromMarkdown(md: string): TocItem[] {
  const used = new Set<string>()
  const items: TocItem[] = []
  let inFence = false
  for (const line of md.split('\n')) {
    if (/^```/.test(line.trim())) inFence = !inFence
    if (inFence) continue
    const m = line.match(/^#{2,3}\s+(.+)$/)
    if (!m) continue
    const text = plainHeadingText(m[1])
    if (!text) continue
    items.push({ id: dedup(slugifyHeading(text), used), text })
  }
  return items
}

/** TOC из блоков статьи (type h2); index — позиция блока для связки рендера и якоря */
export function tocFromBlocks(blocks: ArticleBlock[]): TocItem[] {
  const used = new Set<string>()
  const items: TocItem[] = []
  blocks.forEach((b, index) => {
    if (b.type !== 'h2') return
    const text = plainHeadingText(b.text)
    if (!text) return
    items.push({ id: dedup(slugifyHeading(text), used), text, index })
  })
  return items
}
