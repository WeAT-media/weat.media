import type { ReactNode } from 'react'
import { safeHref, safeImageSrc } from '@/lib/safeUrl'

/** Рендер inline-markdown: **жирный**, *курсив*, [текст](url) → React-узлы */
export function renderInline(text: string): ReactNode[] {
  return text
    .split(/(!\[[^\]]*\]\([^)]+\)|\*\*[^*]+\*\*|\*[^*]+\*|\[[^\]]+\]\([^)]+\))/g)
    .filter(Boolean)
    .map((part, i) => {
      const img = part.match(/^!\[([^\]]*)\]\(([^)\s]+)[^)]*\)$/)
      if (img) {
        const src = safeImageSrc(img[2])
        return src ? <img key={i} src={src} alt={img[1]} loading="lazy" referrerPolicy="no-referrer" className="inline-block max-h-64 max-w-full align-middle" /> : <span key={i}>{img[1]}</span>
      }
      if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
        return (
          <strong key={i} className="font-bold">
            {part.slice(2, -2)}
          </strong>
        )
      }
      if (part.startsWith('*') && part.endsWith('*') && part.length > 2) {
        return <em key={i}>{part.slice(1, -1)}</em>
      }
      const link = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/)
      // небезопасная схема — показываем текст ссылки без ссылки
      if (link && !safeHref(link[2])) return <span key={i}>{link[1]}</span>
      if (link) {
        return (
          <a
            key={i}
            href={safeHref(link[2])}
            target="_blank"
            rel="noreferrer"
            className="font-medium text-accent underline decoration-accent/50 underline-offset-4 transition-colors hover:decoration-accent"
          >
            {link[1]}
          </a>
        )
      }
      return <span key={i}>{part}</span>
    })
}
