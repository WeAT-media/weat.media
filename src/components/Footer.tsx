import { Link } from 'react-router'
import { useStore } from '@/lib/store'
import { SOURCE_URL } from '@/config/site'
import BrandName from '@/components/BrandName'
import WheatMark from '@/components/WheatMark'
import { LEGAL_DOCS } from '@/pages/legal/documents'
import { reopenConsent } from '@/lib/consent'

const col = 'flex flex-col gap-2 font-mono text-[12px] uppercase tracking-[0.08em] text-primary-foreground/70'
const link = 'transition-colors hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

export default function Footer() {
  const { cases, caseStats } = useStore()
  const open = cases.filter((c) => !caseStats(c).closed).length
  return (
    <footer className="bg-primary text-primary-foreground">
      <div className="mx-auto flex max-w-[1200px] flex-col gap-6 px-5 py-12 md:flex-row md:items-start md:justify-between md:gap-10 md:px-8">
        <div>
          <WheatMark className="h-16 w-16" stemClass="text-primary-foreground" />
          <p className="mt-3 text-2xl font-extrabold tracking-tight"><BrandName /></p>
          <p className="mt-3 max-w-[52ch] text-sm leading-relaxed text-primary-foreground/70">
            Сообщество, свободное от всех: ни площадка, ни модератор не могут удалить вашу работу — спорные
            вердикты выносят случайные коллегии присяжных.
          </p>
        </div>
        <nav aria-label="Площадка" className={`${col} whitespace-nowrap`}>
          <span className="text-primary-foreground">Площадка</span>
          <Link to="/feed" className={link}>Лента</Link>
          <Link to="/settings" className={link}>Модерация</Link>
          <Link to="/support" className={link}>Поддержка</Link>
          {/* AGPL-3.0 §13: пользователи сетевого сервиса должны получить исходный код */}
          <a href={SOURCE_URL} target="_blank" rel="noopener noreferrer" className={link}>
            Исходный код · AGPL-3.0
          </a>
          <span className="mt-2 text-primary-foreground/45">Открытых дел: {open}</span>
        </nav>
        <nav aria-label="Партнёрам" className={`${col} whitespace-nowrap`}>
          <span className="text-primary-foreground">Партнёрам</span>
          <Link to="/api" className={link}>API</Link>
          <Link to="/docs" className={link}>Документация</Link>
          <Link to="/design" className={link}>Дизайнерам</Link>
          <Link to="/ads" className={link}>Рекламодателям</Link>
          <Link to="/ads/dashboard" className={link}>Кабинет рекламодателя</Link>
        </nav>
        <nav aria-label="Правовая информация" className={col}>
          <Link to="/legal" className={`${link} text-primary-foreground`}>Правовая информация</Link>
          {LEGAL_DOCS.map((d) => (
            <Link key={d.slug} to={`/legal/${d.slug}`} className={link}>{d.title}</Link>
          ))}
          <Link to="/support/legal" className={link}>Запросы органов</Link>
          <button type="button" onClick={reopenConsent} className={`${link} cursor-pointer text-left uppercase`}>Настройки cookie</button>
        </nav>
      </div>
    </footer>
  )
}
