import { Link, Navigate, NavLink, Outlet, useLocation, useParams } from 'react-router'
import { Bell, Code2, Download, FileText, Languages, UserRound, Gavel, History, LayoutList, Link2, Lock, Palette, PenLine, Pin, ShieldAlert, SlidersHorizontal, Wallet } from 'lucide-react'
import { useStore, type SettingsSyncState } from '@/lib/store'
import { useI18n, type TranslationKey } from '@/lib/i18n'

const navItems: { to: string; label: TranslationKey; icon: typeof UserRound }[] = [
  { to: 'profile', label: 'profile', icon: UserRound },
  { to: 'drafts', label: 'drafts', icon: FileText },
  { to: 'feed', label: 'feed', icon: LayoutList },
  { to: 'appearance', label: 'appearance', icon: Palette },
  { to: 'language', label: 'language', icon: Languages },
  { to: 'notifications', label: 'notificationSettings', icon: Bell },
  { to: 'history', label: 'history', icon: History },
  { to: 'editor', label: 'editor', icon: PenLine },
  { to: 'import', label: 'importPosts', icon: Download },
  { to: 'jury', label: 'jury', icon: Gavel },
  { to: 'payouts', label: 'payouts', icon: Wallet },
  { to: 'ad-pins', label: 'adPins', icon: Pin },
  { to: 'moderation', label: 'moderation', icon: SlidersHorizontal },
  { to: 'accounts', label: 'linkedAccounts', icon: Link2 },
  { to: 'security', label: 'security', icon: Lock },
  { to: 'developer', label: 'developer', icon: Code2 },
]

export default function SettingsLayout() {
  const { id = '' } = useParams()
  const { user, settingsSync } = useStore()
  const { t } = useI18n()
  const location = useLocation()
  if (!user) return <Navigate to={`/login?returnTo=${encodeURIComponent(location.pathname)}`} replace />

  const syncLabel: Record<SettingsSyncState, string> = { local: t('localSettings'), syncing: t('saving'), saved: '', error: t('settingsError') }
  const decoded = decodeURIComponent(id)
  if (decoded !== user.handle && decoded !== user.did) {
    return (
      <div className="mx-auto max-w-[720px] px-5 py-24 text-center">
        <ShieldAlert size={22} className="mx-auto text-accent" aria-hidden="true" />
        <p className="meta mt-4">{t('accessDenied')}</p>
        <h1 className="mt-4 text-3xl font-extrabold tracking-tight">{t('otherProfileSettings')}</h1>
        <p className="mx-auto mt-3 max-w-[48ch] text-muted-foreground">{t('onlyOwnerSettings')} @{decoded}.</p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link to={`/profile/${user.handle}/settings/feed`} className="btn-primary !px-4 !py-2">{t('mySettings')}</Link>
          <Link to={`/profile/${decoded}`} className="btn-ghost !px-4 !py-2">{t('profile')} @{decoded}</Link>
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-[1100px] px-5 pb-24 md:px-8">
      <div className="pt-10">
        <p className="meta" role="status" aria-live="polite">@{user.handle}{syncLabel[settingsSync] ? ` · ${syncLabel[settingsSync]}` : ''}</p>
        <h1 className="mt-2 text-4xl font-extrabold tracking-tight md:text-5xl">{t('settings')}</h1>
      </div>
      <div className="mt-10 grid gap-10 md:grid-cols-[220px_minmax(0,1fr)]">
        <nav aria-label={t('settingsSections')} className="flex gap-1 overflow-x-auto border-b border-border pb-2 md:flex-col md:border-b-0 md:pb-0">
          {navItems.map((item) => (
            <NavLink key={item.to} to={item.to} className={({ isActive }) => `flex shrink-0 items-center gap-2.5 rounded-md px-3.5 py-2.5 font-mono text-[13px] font-semibold tracking-[0.04em] transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${isActive ? 'bg-primary text-primary-foreground' : 'text-foreground hover:bg-secondary hover:text-accent'}`}>
              <item.icon size={14} aria-hidden="true" />{t(item.label)}
            </NavLink>
          ))}
        </nav>
        <div className="min-w-0"><Outlet /></div>
      </div>
    </div>
  )
}
