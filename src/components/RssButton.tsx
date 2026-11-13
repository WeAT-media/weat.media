import { useState } from 'react'
import { Check, Rss } from 'lucide-react'
import { downloadXml } from '@/lib/rss'

const cls =
  'inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-border px-3 py-1.5 font-mono text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground transition-colors hover:border-accent hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

/**
 * RSS. href — постоянный адрес ленты (сервис ленты): открыть и скопировать для читалки.
 * Без href (демо-данные, суд до сервиса лейблеров) — скачать собранный в браузере .xml.
 */
export default function RssButton({
  filename,
  buildXml,
  label,
  href,
}: {
  filename: string
  buildXml: () => string
  label: string
  href?: string
}) {
  const [copied, setCopied] = useState(false)
  if (href) {
    const url = new URL(href, window.location.origin).toString()
    return (
      <span className="inline-flex items-center gap-1">
        <a href={url} target="_blank" rel="noopener" type="application/rss+xml" title={`${label} — подписаться в RSS-читалке`} className={cls}>
          <Rss size={12} aria-hidden="true" /> {label}
        </a>
        <button
          type="button"
          onClick={() => navigator.clipboard.writeText(url).then(() => setCopied(true), () => {})}
          title="Скопировать адрес ленты"
          className={`${cls} !px-2`}
        >
          {copied ? <Check size={12} aria-hidden="true" /> : 'адрес'}
        </button>
      </span>
    )
  }
  return (
    <button type="button" onClick={() => downloadXml(filename, buildXml())} title={`${label} — скачать .xml`} className={cls}>
      <Rss size={12} aria-hidden="true" /> {label}
    </button>
  )
}
