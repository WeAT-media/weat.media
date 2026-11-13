import { useMemo, useState } from 'react'
import { Check, ChevronDown, X } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { countryLabel } from '@/lib/api'
import { COUNTRY_CODES, POPULAR_COUNTRIES } from '@/data/countries'

/**
 * Выбор стран с поиском и флагами. multiple — несколько (чипы снимаются ×), иначе одна.
 * Поиск — по названию на русском и по коду (RU, KZ).
 */
export default function CountrySelect({
  value,
  onChange,
  multiple = false,
  placeholder,
  label,
}: {
  value: string[]
  onChange: (codes: string[]) => void
  multiple?: boolean
  placeholder: string
  /** для экранных чтецов */
  label: string
}) {
  const [open, setOpen] = useState(false)
  const options = useMemo(() => {
    const rest = COUNTRY_CODES.filter((c) => !POPULAR_COUNTRIES.includes(c))
      .map((code) => ({ code, label: countryLabel(code) }))
      .sort((a, b) => a.label.slice(3).localeCompare(b.label.slice(3), 'ru'))
    return [...POPULAR_COUNTRIES.map((code) => ({ code, label: countryLabel(code) })), ...rest]
  }, [])
  const toggle = (code: string) => {
    if (!multiple) {
      onChange(value[0] === code ? [] : [code])
      setOpen(false)
      return
    }
    onChange(value.includes(code) ? value.filter((c) => c !== code) : [...value, code])
  }

  return (
    <div className="grid gap-1.5">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={label}
            aria-expanded={open}
            className="flex w-full cursor-pointer items-center justify-between gap-2 rounded-md border border-input bg-background px-3 py-2 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className={value.length ? '' : 'text-muted-foreground'}>
              {value.length === 0 ? placeholder : multiple ? `Выбрано: ${value.length}` : countryLabel(value[0]!)}
            </span>
            <ChevronDown size={14} className="shrink-0 text-muted-foreground" aria-hidden="true" />
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-[min(320px,90vw)] p-0" align="start">
          <Command
            filter={(item, search) => {
              const q = search.trim().toLowerCase()
              return !q || item.toLowerCase().includes(q) ? 1 : 0
            }}
          >
            <CommandInput placeholder="Страна или код: Казахстан, KZ" />
            <CommandList className="max-h-64">
              <CommandEmpty>Не нашли такую страну</CommandEmpty>
              <CommandGroup>
                {options.map((o) => (
                  // value — то, по чему ищем: название и код
                  <CommandItem key={o.code} value={`${o.label} ${o.code}`} onSelect={() => toggle(o.code)}>
                    <Check size={13} className={value.includes(o.code) ? 'text-accent' : 'invisible'} aria-hidden="true" />
                    {o.label}
                    <span className="ml-auto font-mono text-[11px] text-muted-foreground">{o.code}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {multiple && value.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label={`${label}: выбрано`}>
          {value.map((c) => (
            <li key={c} className="inline-flex items-center gap-1 rounded-full border border-border bg-secondary/60 py-0.5 pl-2.5 pr-1 text-[12px]">
              {countryLabel(c)}
              <button
                type="button"
                onClick={() => onChange(value.filter((x) => x !== c))}
                aria-label={`Убрать ${countryLabel(c)}`}
                className="cursor-pointer rounded-full p-0.5 text-muted-foreground hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <X size={11} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
