import { useStore } from '@/lib/store'
import Reveal from '@/components/Reveal'
import { Switch } from '@/components/ui/switch'
import type { Preferences } from '@/types/types'

/** Настройки ленты: сортировка, осуждённые, бегущая строка */
export default function FeedSettingsPage() {
  const { prefs, setPrefs } = useStore()

  return (
    <Reveal className="border border-border bg-secondary/40 p-6">
      <section aria-label="Настройки ленты и интерфейса">
        <h2 className="font-mono text-[13px] font-bold uppercase tracking-[0.12em]">Лента и интерфейс</h2>

        <div className="mt-5 flex flex-wrap items-center justify-between gap-4 border-b border-border/70 pb-5">
          <div>
            <p className="text-sm font-semibold">Сортировка ленты</p>
            <p className="mt-1 text-sm text-muted-foreground">По дате или по горячести BigData-дайджеста.</p>
          </div>
          <div className="flex rounded-full border border-border bg-background p-1" role="group" aria-label="Сортировка ленты">
            {(
              [
                { key: 'new', label: 'Сначала новые' },
                { key: 'hot', label: 'Сначала горячее' },
              ] as const
            ).map((opt) => (
              <button
                key={opt.key}
                onClick={() => setPrefs({ feedSort: opt.key })}
                aria-pressed={prefs.feedSort === opt.key}
                className={`cursor-pointer rounded-full px-4 py-1.5 font-mono text-[12px] font-semibold uppercase tracking-[0.05em] transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  prefs.feedSort === opt.key ? 'bg-primary text-primary-foreground' : 'text-foreground hover:text-accent'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {(
          [
            { key: 'showCondemned', label: 'Показывать осуждённые статьи', hint: 'Если выключено, записи с вердиктом «осуждена» не попадают в ленту вовсе.' },
            { key: 'hideTicker', label: 'Скрыть бегущую строку событий', hint: 'Строка под шапкой исчезает полностью и не занимает место.' },
          ] as const
        ).map((opt) => (
          <div key={opt.key} className="mt-5 flex flex-wrap items-center justify-between gap-4">
            <div className="max-w-[52ch]">
              <p className="text-sm font-semibold">{opt.label}</p>
              <p className="mt-1 text-sm text-muted-foreground">{opt.hint}</p>
            </div>
            <Switch
              size="lg"
              checked={opt.key === 'hideTicker' ? !prefs.hideTicker : prefs.showCondemned}
              aria-label={opt.label}
              onCheckedChange={() =>
                setPrefs(opt.key === 'hideTicker' ? { hideTicker: !prefs.hideTicker } : { showCondemned: !prefs.showCondemned })
              }
            />
          </div>
        ))}

        <div className="mt-5 flex flex-wrap items-center justify-between gap-4 border-t border-border/70 pt-5">
          <div className="max-w-[52ch]">
            <p className="text-sm font-semibold">Язык бегущей строки</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Шаблоны событий («новая запись», комментарий, вердикт) на русском или английском; названия записей
              и @handle остаются оригинальными. «Как в системе» следует языку интерфейса.
            </p>
          </div>
          <select
            aria-label="Язык бегущей строки"
            value={prefs.tickerLang}
            onChange={(e) => setPrefs({ tickerLang: e.target.value as Preferences['tickerLang'] })}
            className="cursor-pointer rounded-md border border-input bg-background px-3 py-2 font-mono text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="system">Как в системе</option>
            <option value="ru">Русский</option>
            <option value="en">English</option>
          </select>
        </div>
      </section>
    </Reveal>
  )
}
