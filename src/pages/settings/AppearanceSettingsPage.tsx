import { useStore } from '@/lib/store'
import { CURRENCIES } from '@/lib/money'
import Reveal from '@/components/Reveal'
import type { Preferences } from '@/types/types'
import { useI18n } from '@/lib/i18n'

const selectCls = 'mt-2 w-full cursor-pointer rounded-md border border-input bg-background px-3 py-2 font-mono text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

export default function AppearanceSettingsPage() {
  const { prefs, setPrefs } = useStore()
  const { t } = useI18n()
  return (
    <Reveal className="border border-border p-6">
      <section aria-label={t('appearance')}>
        <h2 className="font-mono text-[13px] font-bold uppercase tracking-[0.12em]">{t('appearance')}</h2>
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="pref-font" className="meta">{t('interfaceFont')}</label>
            <select id="pref-font" value={prefs.font} onChange={(e) => setPrefs({ font: e.target.value as Preferences['font'] })} className={selectCls}>
              <option value="sans">Inter ({t('default')})</option><option value="serif">{t('systemSerif')}</option><option value="mono">{t('monospace')}</option>
            </select>
          </div>
          <div>
            <label htmlFor="pref-appearance" className="meta">{t('theme')}</label>
            <select id="pref-appearance" value={prefs.appearance} onChange={(e) => setPrefs({ appearance: e.target.value as Preferences['appearance'], appearanceSet: true })} className={selectCls}>
              <option value="system">{t('systemTheme')}</option><option value="light">{t('lightTheme')}</option><option value="dark">{t('darkTheme')}</option>
            </select>
          </div>
          <div>
            <label htmlFor="pref-accent" className="meta">{t('accentColor')}</label>
            <select id="pref-accent" value={prefs.accent} onChange={(e) => setPrefs({ accent: e.target.value as Preferences['accent'] })} className={selectCls}>
              <option value="terracotta">{t('terracotta')}</option><option value="forest">{t('forest')}</option><option value="indigo">{t('indigo')}</option><option value="crimson">{t('crimson')}</option>
            </select>
          </div>
          <div>
            <label htmlFor="pref-currency" className="meta">{t('currency')}</label>
            <select id="pref-currency" value={prefs.currency} onChange={(e) => setPrefs({ currency: e.target.value as Preferences['currency'] })} className={selectCls}>
              {CURRENCIES.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}
            </select>
            <p className="meta mt-2 !normal-case tracking-normal">{t('currencyDescription')}</p>
          </div>
        </div>
      </section>
    </Reveal>
  )
}
