import { useEffect, useState } from 'react'
import { ListTree } from 'lucide-react'
import type { TocItem } from '@/lib/toc'

interface ArticleTocProps {
  items: TocItem[]
  /**
   * 'anchor' — обычные якорные ссылки (страница статьи, предпросмотр);
   * 'callback' — клик вызывает onNavigate (например, прокрутка к редактору в Compose)
   */
  onNavigate?: (item: TocItem) => void
  /** id контейнера, в котором живут заголовки с этими id (для подсветки активного раздела) */
  observeRootId?: string
}

function TocLink({
  item,
  active,
  onNavigate,
}: {
  item: TocItem
  active: boolean
  onNavigate?: (item: TocItem) => void
}) {
  const cls = `block truncate border-l-2 py-1 pl-3 text-[13px] leading-snug transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
    active
      ? 'border-accent font-semibold text-accent'
      : 'border-border text-muted-foreground hover:border-accent hover:text-accent'
  }`
  if (onNavigate) {
    return (
      <button type="button" onClick={() => onNavigate(item)} aria-current={active ? 'location' : undefined} className={`${cls} w-full cursor-pointer text-left`}>
        {item.text}
      </button>
    )
  }
  return (
    <a href={`#${item.id}`} aria-current={active ? 'location' : undefined} className={cls}>
      {item.text}
    </a>
  )
}

/**
 * Оглавление статьи по заголовкам h2/###. Пустое состояние не рендерится.
 * Desktop — sticky-список, mobile — details/accordion. Активный раздел
 * отслеживается IntersectionObserver'ом по id заголовков в observeRootId.
 */
export default function ArticleToc({ items, onNavigate, observeRootId }: ArticleTocProps) {
  const [activeId, setActiveId] = useState<string | null>(null)

  useEffect(() => {
    if (!observeRootId || items.length === 0 || !('IntersectionObserver' in window)) return
    const root = document.getElementById(observeRootId)
    if (!root) return
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) setActiveId(e.target.id)
        }
      },
      // sticky header ~64px: активным считаем заголовок в верхней трети вьюпорта
      { rootMargin: '-80px 0px -65% 0px', threshold: 0 },
    )
    for (const item of items) {
      const el = root.querySelector(`#${CSS.escape(item.id)}`)
      if (el) io.observe(el)
    }
    return () => io.disconnect()
  }, [items, observeRootId])

  if (items.length === 0) return null

  const list = (
    <ul className="space-y-0.5">
      {items.map((item) => (
        <li key={item.id}>
          <TocLink item={item} active={activeId === item.id} onNavigate={onNavigate} />
        </li>
      ))}
    </ul>
  )

  return (
    <nav aria-label="Содержание статьи">
      {/* mobile: details/accordion */}
      <details className="rounded-md border border-border bg-secondary/40 p-4 xl:hidden">
        <summary className="meta inline-flex cursor-pointer list-none items-center gap-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <ListTree size={12} aria-hidden="true" /> Содержание · {items.length}
        </summary>
        <div className="mt-3">{list}</div>
      </details>
      {/* desktop: sticky-блок (родитель решает раскладку) */}
      <div className="hidden xl:block">
        <p className="meta mb-3 inline-flex items-center gap-1.5">
          <ListTree size={12} aria-hidden="true" /> Содержание
        </p>
        {list}
      </div>
    </nav>
  )
}
