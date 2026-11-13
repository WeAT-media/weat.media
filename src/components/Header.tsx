import { Link, NavLink } from 'react-router'
import { LogIn, LogOut, PenLine, Crown } from 'lucide-react'
import { useStore } from '@/lib/store'
import NotificationsMenu from '@/components/NotificationsMenu'
import BrandName from '@/components/BrandName'
import WheatMark from '@/components/WheatMark'

const navItems = [
  { to: '/feed', label: 'Лента' },
  { to: '/hot', label: 'Горячее' },
  { to: '/collections', label: 'Подборки' },
  { to: '/cases', label: 'Суд' },
]

function SlideLabel({ text }: { text: string }) {
  return (
    <span className="link-slide">
      <span>{text}</span>
      <span aria-hidden="true">{text}</span>
    </span>
  )
}

export default function Header() {
  const { user, logout } = useStore()
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/90 backdrop-blur-sm">
      <div className="mx-auto flex min-h-16 max-w-[1200px] flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 py-3 md:h-16 md:flex-nowrap md:gap-4 md:px-8 md:py-0">
        <Link
          to="/"
          className="flex shrink-0 items-center gap-2.5 text-[19px] font-extrabold tracking-tight text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <WheatMark />
          <BrandName />
        </Link>

        <nav aria-label="Основная навигация" className="order-3 flex w-full min-w-0 max-w-full items-center gap-1 overflow-x-auto rounded-full border border-border bg-secondary/60 px-1.5 py-1 md:order-2 md:w-auto">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/feed'}
              className={({ isActive }) =>
                `shrink-0 whitespace-nowrap rounded-full px-3.5 py-1.5 font-mono text-[13px] font-semibold tracking-[0.04em] transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  isActive ? 'bg-primary text-primary-foreground' : 'text-foreground hover:text-accent'
                }`
              }
            >
              <SlideLabel text={item.label} />
            </NavLink>
          ))}
        </nav>

        <div className="order-2 ml-auto flex shrink-0 items-center gap-2 md:order-3">
          {/* уведомления есть только у вошедших */}
          {user && <NotificationsMenu />}
          {user ? (
            <>
              <Link
                to={`/profile/${user.handle}`}
                title="Ваш профиль"
                className="hidden items-center gap-1.5 rounded-full border border-border px-3 py-1.5 font-mono text-[12px] font-semibold transition-colors hover:border-accent hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:inline-flex"
              >
                @{user.handle}
                {user.premium && <Crown size={12} className="text-accent" aria-label="Premium" />}
              </Link>
              <button
                onClick={logout}
                aria-label="Выйти"
                title="Выйти"
                className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-full border border-border text-foreground transition-colors hover:border-accent hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <LogOut size={14} aria-hidden="true" />
              </button>
            </>
          ) : (
            <Link to="/login" className="btn-ghost !px-4 !py-2">
              <LogIn size={14} aria-hidden="true" />
              <span className="hidden sm:inline">Войти</span>
            </Link>
          )}
          <Link to="/compose" className="btn-primary !px-4 !py-2">
            <PenLine size={14} aria-hidden="true" />
            <span className="hidden sm:inline">Написать</span>
          </Link>
        </div>
      </div>
    </header>
  )
}
