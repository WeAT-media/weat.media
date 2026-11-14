import { Link, Navigate, NavLink, Outlet, useLocation, useParams } from 'react-router'
import { Code2, Download, UserRound, Gavel, History, LayoutList, Link2, Lock, Palette, PenLine, Pin, ShieldAlert, SlidersHorizontal, Wallet } from 'lucide-react'
import { useStore, type SettingsSyncState } from '@/lib/store'

const syncLabel: Record<SettingsSyncState, string> = {
  local: 'демо-аккаунт: настройки только в этом браузере',
  syncing: 'сохраняем…',
  saved: '',
  error: 'не удалось сохранить на сервере — изменения есть только в этом браузере',
}

const navItems = [
  { to: 'profile', label: 'Профиль', icon: UserRound },
  { to: 'feed', label: 'Лента', icon: LayoutList },
  { to: 'appearance', label: 'Внешний вид', icon: Palette },
  { to: 'history', label: 'История', icon: History },
  { to: 'editor', label: 'Редактор', icon: PenLine },
  { to: 'import', label: 'Импорт постов', icon: Download },
  { to: 'jury', label: 'Участие в суде', icon: Gavel },
  { to: 'payouts', label: 'Выплаты', icon: Wallet },
  { to: 'ad-pins', label: 'Реклама в постах', icon: Pin },
  { to: 'moderation', label: 'Модерация', icon: SlidersHorizontal },
  { to: 'accounts', label: 'Связанные аккаунты', icon: Link2 },
  { to: 'security', label: 'Безопасность', icon: Lock },
  { to: 'developer', label: 'Разработчикам', icon: Code2 },
]

/**
 * Каркас настроек, привязанных к профилю (/profile/:id/settings/*):
 * слева список разделов, справа содержимое; на мобильном — горизонтальная прокрутка.
 * Настройки только для авторизованного владельца профиля: гость → login, чужой id → отказ.
 */
export default function SettingsLayout() {
  const { id = '' } = useParams()
  const { user, settingsSync } = useStore()
  const location = useLocation()

  if (!user) {
    return <Navigate to={`/login?returnTo=${encodeURIComponent(location.pathname)}`} replace />
  }

  const decoded = decodeURIComponent(id)
  if (decoded !== user.handle && decoded !== user.did) {
    return (
      <div className="mx-auto max-w-[720px] px-5 py-24 text-center">
        <ShieldAlert size={22} className="mx-auto text-accent" aria-hidden="true" />
        <p className="meta mt-4">Доступ запрещён</p>
        <h1 className="mt-4 text-3xl font-extrabold tracking-tight">Это настройки другого профиля</h1>
        <p className="mx-auto mt-3 max-w-[48ch] text-muted-foreground">
          Менять предпочтения может только владелец аккаунта. Публичный профиль @{decoded} доступен всем.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link to={`/profile/${user.handle}/settings/feed`} className="btn-primary !px-4 !py-2">
            Мои настройки
          </Link>
          <Link to={`/profile/${decoded}`} className="btn-ghost !px-4 !py-2">
            Профиль @{decoded}
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-[1100px] px-5 pb-24 md:px-8">
      <div className="pt-10">
        <p className="meta" role="status" aria-live="polite">
          @{user.handle}{syncLabel[settingsSync] ? ` · ${syncLabel[settingsSync]}` : ''}
        </p>
        <h1 className="mt-2 text-4xl font-extrabold tracking-tight md:text-5xl">Настройки</h1>
      </div>

      <div className="mt-10 grid gap-10 md:grid-cols-[220px_minmax(0,1fr)]">
        <nav
          aria-label="Разделы настроек"
          className="flex gap-1 overflow-x-auto border-b border-border pb-2 md:flex-col md:border-b-0 md:pb-0"
        >
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `flex shrink-0 items-center gap-2.5 rounded-md px-3.5 py-2.5 font-mono text-[13px] font-semibold tracking-[0.04em] transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  isActive ? 'bg-primary text-primary-foreground' : 'text-foreground hover:bg-secondary hover:text-accent'
                }`
              }
            >
              <item.icon size={14} aria-hidden="true" />
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="min-w-0">
          <Outlet />
        </div>
      </div>
    </div>
  )
}
