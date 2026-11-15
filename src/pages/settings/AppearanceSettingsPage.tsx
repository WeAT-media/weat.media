import { useStore } from '@/lib/store'
import { CURRENCIES } from '@/lib/money'
import Reveal from '@/components/Reveal'
import type { Preferences } from '@/types/types'

const selectCls =
  'mt-2 w-full cursor-pointer rounded-md border border-input bg-background px-3 py-2 font-mono text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

/** Внешний вид: шрифт, тема, акцентный цвет, язык интерфейса */
export default function AppearanceSettingsPage() {
  const { prefs, setPrefs } = useStore()

  return (
    <Reveal className="border border-border p-6">
      <section aria-label="Внешний вид">
        <h2 className="font-mono text-[13px] font-bold uppercase tracking-[0.12em]">Внешний вид</h2>

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="pref-font" className="meta">Шрифт интерфейса</label>
            <select
              id="pref-font"
              value={prefs.font}
              onChange={(e) => setPrefs({ font: e.target.value as Preferences['font'] })}
              className={selectCls}
            >
              <option value="sans">Inter (по умолчанию)</option>
              <option value="serif">Системная антиква (Georgia)</option>
              <option value="mono">Моноширинный (JetBrains Mono)</option>
            </select>
          </div>
          <div>
            <label htmlFor="pref-appearance" className="meta">Тема</label>
            <select
              id="pref-appearance"
              value={prefs.appearance}
              onChange={(e) => setPrefs({ appearance: e.target.value as Preferences['appearance'], appearanceSet: true })}
              className={selectCls}
            >
              <option value="system">Как в системе</option>
              <option value="light">Светлая</option>
              <option value="dark">Тёмная</option>
            </select>
          </div>
          <div>
            <label htmlFor="pref-accent" className="meta">Акцентный цвет</label>
            <select
              id="pref-accent"
              value={prefs.accent}
              onChange={(e) => setPrefs({ accent: e.target.value as Preferences['accent'] })}
              className={selectCls}
            >
              <option value="terracotta">Терракота</option>
              <option value="forest">Хвоя</option>
              <option value="indigo">Индиго</option>
              <option value="crimson">Малина</option>
            </select>
          </div>
          <div>
            <label htmlFor="pref-uilang" className="meta">Язык интерфейса</label>
            <select
              id="pref-uilang"
              value={prefs.uiLang}
              onChange={(e) => setPrefs({ uiLang: e.target.value as Preferences['uiLang'] })}
              className={selectCls}
            >
              <option value="ru">Русский</option>
              <option value="en">English</option>
            </select>
            <p className="meta mt-2 !normal-case tracking-normal">
              честно: меняет lang документа и служебные метаданные; полного перевода текстов пока нет
            </p>
          </div>
          <div>
            <label htmlFor="pref-currency" className="meta">Валюта</label>
            <select
              id="pref-currency"
              value={prefs.currency}
              onChange={(e) => setPrefs({ currency: e.target.value as Preferences['currency'] })}
              className={selectCls}
            >
              {CURRENCIES.map((c) => (
                <option key={c.code} value={c.code}>{c.label}</option>
              ))}
            </select>
            <p className="meta mt-2 !normal-case tracking-normal">
              по умолчанию — по стране; цены новых платных статей и тарифов будут в этой валюте
            </p>
          </div>
        </div>
      </section>
    </Reveal>
  )
}
