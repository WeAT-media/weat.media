import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { Search, X } from 'lucide-react'

const MAX_SUGGESTIONS = 10
const POPULAR_COUNT = 6

/**
 * Мультивыбор тегов с autocomplete: подстрока, подсказки с числом записей,
 * клавиатура (ArrowUp/Down/Enter/Escape), combobox/listbox-семантика.
 * Каждый выбранный — chip с X; повторный выбор снимает фильтр; «сбросить все»
 * очищает список; input остаётся для следующего тега.
 */
export default function TagAutocomplete({
  tags,
  selected,
  onToggle,
  onClear,
}: {
  /** пары [тег, число записей], уже отсортированные по популярности */
  tags: [string, number][]
  selected: string[]
  onToggle: (tag: string) => void
  onClear: () => void
}) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const rootRef = useRef<HTMLDivElement>(null)
  const listId = 'tag-filter-listbox'

  const suggestions = useMemo(() => {
    const q = query.trim().toLowerCase()
    const pool = tags
    if (!q) return pool.slice(0, POPULAR_COUNT)
    const starts: [string, number][] = []
    const contains: [string, number][] = []
    for (const item of pool) {
      const t = item[0].toLowerCase()
      if (t.startsWith(q)) starts.push(item)
      else if (t.includes(q)) contains.push(item)
    }
    return [...starts, ...contains].slice(0, MAX_SUGGESTIONS)
  }, [tags, query])

  // закрытие по клику вне компонента
  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  const pick = (tag: string) => {
    onToggle(tag) // повторный выбор снимает тег
    setQuery('')
    setActive(-1)
    setOpen(false)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || (e.key === 'ArrowUp' && open)) {
      e.preventDefault()
      if (!open) {
        setOpen(true)
        setActive(0)
        return
      }
      if (suggestions.length === 0) return
      setActive((i) => (e.key === 'ArrowDown' ? (i + 1) % suggestions.length : (i - 1 + suggestions.length) % suggestions.length))
    } else if (e.key === 'Enter') {
      if (open && active >= 0 && suggestions[active]) {
        e.preventDefault()
        pick(suggestions[active][0])
      } else if (open && suggestions.length === 1) {
        e.preventDefault()
        pick(suggestions[0][0])
      }
    } else if (e.key === 'Escape') {
      setOpen(false)
      setActive(-1)
    }
  }

  return (
    <div ref={rootRef}>
      {selected.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-1.5">
          {selected.map((t) => (
            <span
              key={t}
              className="inline-flex items-center gap-1.5 rounded-full border border-primary bg-primary px-3 py-1 font-mono text-[12px] font-semibold text-primary-foreground"
            >
              #{t}
              <button
                type="button"
                onClick={() => onToggle(t)}
                aria-label={`Снять тег ${t}`}
                className="cursor-pointer transition-colors hover:text-accent-foreground/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <X size={11} aria-hidden="true" />
              </button>
            </span>
          ))}
          <button
            type="button"
            onClick={onClear}
            className="meta cursor-pointer !normal-case tracking-normal text-muted-foreground underline-offset-4 transition-colors hover:text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Сбросить все
          </button>
        </div>
      )}

      <div className="relative">
        <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setOpen(true)
            setActive(-1)
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-activedescendant={open && active >= 0 ? `${listId}-opt-${active}` : undefined}
          aria-autocomplete="list"
          aria-label="Поиск по тегам"
          placeholder={selected.length > 0 ? 'Ещё тег…' : 'Найти тег: perfscale…'}
          className="w-full rounded-md border border-input bg-background py-2 pl-9 pr-3 font-mono text-[13px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />

        {open && (
          <ul
            id={listId}
            role="listbox"
            aria-label="Теги"
            aria-multiselectable="true"
            className="absolute z-30 mt-1.5 max-h-72 w-full overflow-y-auto rounded-md border border-border bg-background shadow-md"
          >
            {suggestions.length === 0 ? (
              <li className="px-3.5 py-3 text-sm text-muted-foreground" aria-disabled="true">
                Тег «{query.trim()}» не найден
              </li>
            ) : (
              <>
                {!query.trim() && (
                  <li className="meta px-3.5 pb-1 pt-2.5" aria-hidden="true">
                    популярное
                  </li>
                )}
                {suggestions.map(([t, count], i) => {
                  const isSelected = selected.includes(t)
                  return (
                    <li
                      key={t}
                      id={`${listId}-opt-${i}`}
                      role="option"
                      aria-selected={isSelected || i === active}
                      onPointerDown={(e) => e.preventDefault()}
                      onClick={() => pick(t)}
                      onMouseEnter={() => setActive(i)}
                      className={`flex cursor-pointer items-center justify-between gap-3 px-3.5 py-2 font-mono text-[13px] ${
                        i === active ? 'bg-secondary text-accent' : 'text-foreground'
                      }`}
                    >
                      <span className="truncate">
                        #{t}
                        {isSelected && <span className="meta ml-1.5 text-accent">· выбран</span>}
                      </span>
                      <span className="meta shrink-0">{count}</span>
                    </li>
                  )
                })}
              </>
            )}
          </ul>
        )}
      </div>
    </div>
  )
}
