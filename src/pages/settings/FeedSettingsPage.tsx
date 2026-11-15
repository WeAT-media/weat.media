import { useStore } from '@/lib/store'
import Reveal from '@/components/Reveal'
import { Switch } from '@/components/ui/switch'
import type { Preferences } from '@/types/types'
import { useI18n, type TranslationKey } from '@/lib/i18n'

export default function FeedSettingsPage() {
  const { prefs, setPrefs } = useStore()
  const { t } = useI18n()
  const switches: { key: 'showCondemned' | 'hideTicker'; label: TranslationKey; hint: TranslationKey }[] = [
    { key: 'showCondemned', label: 'showCondemned', hint: 'showCondemnedHint' },
    { key: 'hideTicker', label: 'hideTicker', hint: 'hideTickerHint' },
  ]
  return (
    <Reveal className="border border-border bg-secondary/40 p-6">
      <section aria-label={t('feedInterfaceSettings')}>
        <h2 className="font-mono text-[13px] font-bold uppercase tracking-[0.12em]">{t('feedInterface')}</h2>
        <div className="mt-5 flex flex-wrap items-center justify-between gap-4 border-b border-border/70 pb-5">
          <div><p className="text-sm font-semibold">{t('feedSort')}</p><p className="mt-1 text-sm text-muted-foreground">{t('feedSortDescription')}</p></div>
          <div className="flex rounded-full border border-border bg-background p-1" role="group" aria-label={t('feedSorting')}>
            {([{ key: 'new', label: t('newestFirst') }, { key: 'hot', label: t('hottestFirst') }] as const).map((opt) => (
              <button key={opt.key} onClick={() => setPrefs({ feedSort: opt.key })} aria-pressed={prefs.feedSort === opt.key} className={`cursor-pointer rounded-full px-4 py-1.5 font-mono text-[12px] font-semibold uppercase tracking-[0.05em] transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${prefs.feedSort === opt.key ? 'bg-primary text-primary-foreground' : 'text-foreground hover:text-accent'}`}>{opt.label}</button>
            ))}
          </div>
        </div>
        {switches.map((opt) => (
          <div key={opt.key} className="mt-5 flex flex-wrap items-center justify-between gap-4">
            <div className="max-w-[52ch]"><p className="text-sm font-semibold">{t(opt.label)}</p><p className="mt-1 text-sm text-muted-foreground">{t(opt.hint)}</p></div>
            <Switch size="lg" checked={opt.key === 'hideTicker' ? !prefs.hideTicker : prefs.showCondemned} aria-label={t(opt.label)} onCheckedChange={() => setPrefs(opt.key === 'hideTicker' ? { hideTicker: !prefs.hideTicker } : { showCondemned: !prefs.showCondemned })} />
          </div>
        ))}
        <div className="mt-5 flex flex-wrap items-center justify-between gap-4 border-t border-border/70 pt-5">
          <div className="max-w-[52ch]"><p className="text-sm font-semibold">{t('tickerLanguage')}</p><p className="mt-1 text-sm text-muted-foreground">{t('tickerLanguageDescription')}</p></div>
          <select aria-label={t('tickerLanguage')} value={prefs.tickerLang} onChange={(e) => setPrefs({ tickerLang: e.target.value as Preferences['tickerLang'] })} className="cursor-pointer rounded-md border border-input bg-background px-3 py-2 font-mono text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <option value="system">{t('systemTheme')}</option><option value="ru">{t('russian')}</option><option value="en">{t('english')}</option>
          </select>
        </div>
      </section>
    </Reveal>
  )
}
