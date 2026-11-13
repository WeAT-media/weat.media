import { safeHref } from '@/lib/safeUrl'

/** Кнопка с действием: JSON { label, url, variant, note }; ссылка — https:// или путь на сайте */
export interface ActionButton {
  label: string
  url: string
  variant: 'primary' | 'ghost'
  note: string
}

export function parseActionButton(raw: string): ActionButton | null {
  try {
    const d = JSON.parse(raw) as Partial<ActionButton>
    const label = typeof d.label === 'string' ? d.label.trim().slice(0, 48) : ''
    const href = typeof d.url === 'string' ? safeHref(d.url) : undefined
    // только https и внутренние пути: http и mailto в кнопке не нужны
    if (!label || !href || !(href.startsWith('https://') || href.startsWith('/'))) return null
    return { label, url: href, variant: d.variant === 'ghost' ? 'ghost' : 'primary', note: typeof d.note === 'string' ? d.note.trim().slice(0, 120) : '' }
  } catch {
    return null
  }
}
