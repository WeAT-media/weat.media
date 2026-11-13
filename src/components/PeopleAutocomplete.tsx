import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { Link } from 'react-router'
import { AtSign, X } from 'lucide-react'

const MAX_SUGGESTIONS = 8

export interface PersonCandidate {
  handle: string
  name?: string
}

/** handle в стиле AT Protocol: marat-g.dev, alina-v.bsky.social */
function isValidHandle(raw: string): boolean {
  return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i.test(raw)
}

/**
 * Выбор людей по @handle с autocomplete (паттерн TagAutocomplete):
 * поиск по name/handle, клавиатура (ArrowUp/Down/Enter/Escape),
 * выбранные — chips со ссылкой на /profile/<handle> и кнопкой X.
 */
export default function PeopleAutocomplete({
  id,
  candidates,
  selected,
  onChange,
  max = 1,
  placeholder,
  onError,
}: {
  id: string
  candidates: PersonCandidate[]
  selected: string[]
  onChange: (handles: string[]) => void
  /** сколько человек можно выбрать (по текущей модели — один соавтор/редактор) */
  max?: number
  placeholder?: string
  onError?: (message: string) => void
}) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const rootRef = useRef<HTMLDivElement>(null)
  const listId = `${id}-listbox`

  const suggestions = useMemo(() => {
    const q = query.trim().replace(/^@/, '').toLowerCase()
    const pool = candidates.filter((c) => !selected.includes(c.handle))
    if (!q) return pool.slice(0, MAX_SUGGESTIONS)
    const starts: PersonCandidate[] = []
    const contains: PersonCandidate[] = []
    for (const c of pool) {
      const h = c.handle.toLowerCase()
      const n = (c.name ?? '').toLowerCase()
      if (h.startsWith(q) || n.startsWith(q)) starts.push(c)
      else if (h.includes(q) || n.includes(q)) contains.push(c)
    }
    return [...starts, ...contains].slice(0, MAX_SUGGESTIONS)
  }, [candidates, selected, query])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  const pick = (handle: string) => {
    onChange([...selected, handle])
    setQuery('')
    setActive(-1)
    setOpen(false)
    onError?.('')
  }

  const tryFreeInput = () => {
    const raw = query.trim().replace(/^@/, '')
    if (!raw) return
    if (!isValidHandle(raw)) {
      onError?.(`«${raw}» не похоже на handle: только буквы, цифры, дефис и точки между ними.`)
      return
    }
    const known = candidates.find((c) => c.handle.toLowerCase() === raw.toLowerCase())
    if (!known) {
      onError?.(`@${raw} не найден среди авторов площадки — пригласите человека или проверьте написание.`)
      return
    }
    pick(known.handle)
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
      e.preventDefault()
      if (open && active >= 0 && suggestions[active]) pick(suggestions[active].handle)
      else if (open && suggestions.length === 1) pick(suggestions[0].handle)
      else tryFreeInput()
    } else if (e.key === 'Escape') {
      setOpen(false)
      setActive(-1)
    } else if (e.key === 'Backspace' && !query && selected.length > 0) {
      onChange(selected.slice(0, -1))
    }
  }

  const canType = selected.length < max

  return (
    <div ref={rootRef}>
      <div className="flex flex-wrap items-center gap-2 rounded-md border border-input bg-background px-3 py-2 focus-within:ring-2 focus-within:ring-ring">
        {selected.map((h) => {
          const person = candidates.find((c) => c.handle === h)
          return (
            <span
              key={h}
              className="inline-flex items-center gap-1.5 rounded-full border border-border bg-secondary/60 px-2.5 py-1 font-mono text-[12px] font-semibold"
            >
              <Link
                to={`/profile/${h}`}
                className="underline-offset-4 transition-colors hover:text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                @{h}
                {person?.name ? ` · ${person.name}` : ''}
              </Link>
              <button
                type="button"
                onClick={() => onChange(selected.filter((x) => x !== h))}
                aria-label={`Удалить @${h}`}
                className="cursor-pointer text-muted-foreground transition-colors hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <X size={11} aria-hidden="true" />
              </button>
            </span>
          )
        })}
        {canType && (
          <div className="relative min-w-40 flex-1">
            <AtSign
              size={13}
              className="pointer-events-none absolute left-0 top-1/2 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <input
              id={id}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value)
                setOpen(true)
                setActive(-1)
                onError?.('')
              }}
              onFocus={() => setOpen(true)}
              onKeyDown={onKeyDown}
              role="combobox"
              aria-expanded={open}
              aria-controls={listId}
              aria-activedescendant={open && active >= 0 ? `${listId}-opt-${active}` : undefined}
              aria-autocomplete="list"
              placeholder={placeholder}
              className="w-full bg-transparent py-1 pl-5 font-mono text-sm focus-visible:outline-none"
            />
            {open && (
              <ul
                id={listId}
                role="listbox"
                aria-label="Люди"
                className="absolute left-0 z-30 mt-1.5 max-h-72 w-full min-w-64 overflow-y-auto rounded-md border border-border bg-background shadow-md"
              >
                {suggestions.length === 0 ? (
                  <li className="px-3.5 py-3 text-sm text-muted-foreground" aria-disabled="true">
                    @{query.trim().replace(/^@/, '') || '…'} не найден
                  </li>
                ) : (
                  suggestions.map((c, i) => (
                    <li
                      key={c.handle}
                      id={`${listId}-opt-${i}`}
                      role="option"
                      aria-selected={i === active}
                      onPointerDown={(e) => e.preventDefault()}
                      onClick={() => pick(c.handle)}
                      onMouseEnter={() => setActive(i)}
                      className={`flex cursor-pointer items-center justify-between gap-3 px-3.5 py-2 text-[13px] ${
                        i === active ? 'bg-secondary text-accent' : 'text-foreground'
                      }`}
                    >
                      <span className="truncate font-mono">@{c.handle}</span>
                      {c.name && <span className="meta shrink-0 !normal-case tracking-normal">{c.name}</span>}
                    </li>
                  ))
                )}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
