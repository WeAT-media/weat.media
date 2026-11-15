import Reveal from '@/components/Reveal'
import { Switch } from '@/components/ui/switch'
import { useI18n, type TranslationKey } from '@/lib/i18n'
import { useStore } from '@/lib/store'
import type { NotificationPreferences } from '@/lib/api'

const options: { key: keyof NotificationPreferences; label: TranslationKey; description: TranslationKey }[] = [
  { key: 'articles', label: 'subscribedAuthors', description: 'subscribedAuthorsDescription' },
  { key: 'comments', label: 'commentsOnPosts', description: 'commentsOnPostsDescription' },
  { key: 'replies', label: 'repliesToComments', description: 'repliesToCommentsDescription' },
]

export default function NotificationsSettingsPage() {
  const { notificationPrefs, setNotificationPrefs } = useStore()
  const { t } = useI18n()
  return (
    <Reveal className="border border-border p-6">
      <section aria-labelledby="notification-settings-title">
        <h2 id="notification-settings-title" className="font-mono text-[13px] font-bold uppercase tracking-[0.12em]">{t('notificationSettings')}</h2>
        <p className="mt-3 max-w-[65ch] text-sm leading-relaxed text-muted-foreground">{t('notificationSettingsDescription')}</p>
        <div className="mt-6 divide-y divide-border border-y border-border">
          {options.map((option) => (
            <div key={option.key} className="flex items-start justify-between gap-5 py-5">
              <div>
                <h3 id={`notification-${option.key}-label`} className="text-sm font-semibold">{t(option.label)}</h3>
                <p id={`notification-${option.key}-description`} className="mt-1 text-sm leading-relaxed text-muted-foreground">{t(option.description)}</p>
              </div>
              <Switch checked={notificationPrefs[option.key]} onCheckedChange={(checked) => setNotificationPrefs({ [option.key]: checked })} aria-labelledby={`notification-${option.key}-label`} aria-describedby={`notification-${option.key}-description`} />
            </div>
          ))}
        </div>
      </section>
    </Reveal>
  )
}
