import Reveal from '@/components/Reveal'
import { useI18n } from '@/lib/i18n'
import { useStore } from '@/lib/store'
import type { Preferences } from '@/types/types'

export default function LanguageSettingsPage() {
  const { prefs, setPrefs } = useStore()
  const { t } = useI18n()
  return (
    <Reveal className="border border-border p-6">
      <section aria-labelledby="language-settings-title">
        <h2 id="language-settings-title" className="font-mono text-[13px] font-bold uppercase tracking-[0.12em]">{t('language')}</h2>
        <p className="mt-3 max-w-[65ch] text-sm leading-relaxed text-muted-foreground">{t('languageDescription')}</p>
        <div className="mt-6 flex flex-wrap gap-3" role="group" aria-label={t('language')}>
          {(['ru', 'en'] as const).map((lang) => (
            <button key={lang} type="button" aria-pressed={prefs.uiLang === lang} onClick={() => setPrefs({ uiLang: lang as Preferences['uiLang'] })} className={prefs.uiLang === lang ? 'btn-primary !px-5 !py-2.5' : 'btn-ghost !px-5 !py-2.5'}>
              {lang === 'ru' ? t('russian') : t('english')}
            </button>
          ))}
        </div>
      </section>
    </Reveal>
  )
}
