import type { ReactNode } from 'react'
import { safeHref, safeImageSrc } from '@/lib/safeUrl'

/**
 * Рендер inline-markdown страницы статьи → React-узлы. Тот же markdown пишет редактор (BlockSuite,
 * MarkdownAdapter), поэтому понимаем и его конструкции: экранирование `\x`, подчёркивание как
 * `<u>…</u>` (в т. ч. экранированное `\<u>`), вложенность — **жирный со [ссылкой](url)** и т. п.
 *
 *   **жирный** / __жирный__, *курсив* / _курсив_, ***жирный курсив***, ~~зачёркнутый~~, `код`, <u>подчёркнутый</u>,
 *   [текст](url), ![alt](src)
 */

const linkCls = 'font-medium text-accent underline decoration-accent/50 underline-offset-4 transition-colors hover:decoration-accent'

/** индекс закрывающего маркера (не экранированного) или -1 */
function findClose(s: string, from: number, marker: string): number {
  for (let i = from; i <= s.length - marker.length; i++) {
    if (s[i] === '\\') {
      i++
      continue
    }
    if (s.startsWith(marker, i)) return i
  }
  return -1
}

/** скобки ссылки: [текст](url) — с учётом вложенных [] в тексте */
function matchLink(s: string, i: number): { text: string; url: string; end: number } | null {
  let depth = 0
  for (let j = i; j < s.length; j++) {
    if (s[j] === '\\') {
      j++
      continue
    }
    if (s[j] === '[') depth++
    else if (s[j] === ']' && --depth === 0) {
      if (s[j + 1] !== '(') return null
      const close = s.indexOf(')', j + 2)
      if (close < 0) return null
      return { text: s.slice(i + 1, j), url: s.slice(j + 2, close).trim().split(/\s+/)[0] ?? '', end: close + 1 }
    }
  }
  return null
}

export function renderInline(input: string): ReactNode[] {
  // экранированные угловые скобки BlockSuite (\<u>) — обычные, чтобы распознать <u>
  const s = input.replace(/\\([<>])/g, '$1')
  const out: ReactNode[] = []
  let buf = ''
  let key = 0
  const flush = () => {
    if (buf) out.push(buf)
    buf = ''
  }
  const wrap = (node: (k: number) => ReactNode) => {
    flush()
    out.push(node(key++))
  }

  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!
    // экранирование: \* \_ \[ \` \\ … — символ как есть
    if (ch === '\\' && i + 1 < s.length && /[\\`*_{}[\]()#+\-.!~|<>]/.test(s[i + 1]!)) {
      buf += s[++i]
      continue
    }
    if (ch === '`') {
      const end = findClose(s, i + 1, '`')
      if (end > i + 1) {
        const code = s.slice(i + 1, end)
        wrap((k) => <code key={k} className="rounded bg-secondary px-1 py-0.5 font-mono text-[0.9em]">{code}</code>)
        i = end
        continue
      }
    }
    if (ch === '!' && s[i + 1] === '[') {
      const l = matchLink(s, i + 1)
      if (l) {
        const src = safeImageSrc(l.url)
        wrap((k) => (src ? <img key={k} src={src} alt={l.text} loading="lazy" referrerPolicy="no-referrer" className="inline-block max-h-64 max-w-full align-middle" /> : <span key={k}>{l.text}</span>))
        i = l.end - 1
        continue
      }
    }
    if (ch === '[') {
      const l = matchLink(s, i)
      if (l) {
        const href = safeHref(l.url)
        const inner = renderInline(l.text)
        // небезопасная схема — текст ссылки без ссылки
        wrap((k) =>
          href ? (
            <a key={k} href={href} target="_blank" rel="noreferrer" className={linkCls}>
              {inner}
            </a>
          ) : (
            <span key={k}>{inner}</span>
          ),
        )
        i = l.end - 1
        continue
      }
    }
    if (s.startsWith('<u>', i)) {
      const end = s.indexOf('</u>', i + 3)
      if (end > i) {
        const inner = renderInline(s.slice(i + 3, end))
        wrap((k) => <u key={k} className="underline-offset-4">{inner}</u>)
        i = end + 3
        continue
      }
    }
    // ***жирный курсив*** (и ___…___): иначе ** закрывался внутри *** и оставлял звёздочки
    const triple = s.startsWith('***', i) ? '***' : s.startsWith('___', i) ? '___' : null
    if (triple) {
      const end = findClose(s, i + 3, triple)
      if (end > i + 3) {
        const inner = renderInline(s.slice(i + 3, end))
        wrap((k) => (
          <strong key={k} className="font-bold">
            <em>{inner}</em>
          </strong>
        ))
        i = end + 2
        continue
      }
    }
    const pair = s.startsWith('**', i) ? '**' : s.startsWith('__', i) ? '__' : s.startsWith('~~', i) ? '~~' : null
    if (pair) {
      const end = findClose(s, i + 2, pair)
      if (end > i + 2) {
        const inner = renderInline(s.slice(i + 2, end))
        wrap((k) => (pair === '~~' ? <s key={k}>{inner}</s> : <strong key={k} className="font-bold">{inner}</strong>))
        i = end + 1
        continue
      }
    }
    // одиночный * или _ : курсив, если не внутри слова (snake_case, 2*3 — как есть)
    if ((ch === '*' || ch === '_') && s[i + 1] && s[i + 1] !== ' ' && (ch === '*' || i === 0 || !/\w/.test(s[i - 1]!))) {
      const end = findClose(s, i + 1, ch)
      if (end > i + 1 && s[end - 1] !== ' ' && (ch === '*' || !/\w/.test(s[end + 1] ?? ''))) {
        const inner = renderInline(s.slice(i + 1, end))
        wrap((k) => <em key={k}>{inner}</em>)
        i = end
        continue
      }
    }
    buf += ch
  }
  flush()
  return out
}

/** заголовок / оглавление: текст без разметки (для id-якорей и TOC) */
export function inlinePlain(input: string): string {
  return input
    .replace(/\\([\\`*_{}[\]()#+\-.!~|<>])/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<\/?u>/g, '')
    .replace(/(\*\*\*|___|\*\*|__|~~|`)/g, '')
    .replace(/(^|[^\w])[*_]([^*_]+)[*_](?=[^\w]|$)/g, '$1$2')
}
