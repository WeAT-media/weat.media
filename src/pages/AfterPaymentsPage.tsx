import { useEffect } from 'react'
import { Link } from 'react-router'
import { BadgePercent, Blocks, Download, FileCode2, LineChart, LogIn, PenLine, Sparkles } from 'lucide-react'
import Reveal from '@/components/Reveal'
import { useStore } from '@/lib/store'
import { hasSession } from '@/lib/api'
import { SITE_NAME } from '@/config/site'
import { PREMIUM_SALE_FEE_PCT } from '@/config/premium'
import { FEE_NOTE } from '@/components/FeeNote'

/**
 * Страница после оплаты (ссылка из письма lava.top): благодарность, статус Premium и материалы для покупателей —
 * гайд автора и стикерпак АТика. Только для вошедших; поисковикам закрыта (robots: noindex, Caddy, robots.txt).
 */

const GUIDE: { icon: typeof Blocks; title: string; steps: string[]; link?: { to: string; label: string } }[] = [
  {
    icon: Blocks,
    title: 'Свои блоки: FAQ и кнопка с действием',
    steps: [
      'В редакторе наберите «/» и выберите «FAQ» — вопросы и ответы раскрываются у читателя, поисковики показывают их в выдаче.',
      '«Кнопка» — заметная ссылка «Записаться», «Купить», «Скачать» вместо ссылки в тексте; адрес — https:// или страница сайта.',
      'Свой блок собирается в конструкторе (Настройки → Редактор) — его можно вставлять в любую статью.',
    ],
    link: { to: '/compose', label: 'Открыть редактор' },
  },
  {
    icon: LineChart,
    title: 'Открытая аналитика статьи',
    steps: [
      'На странице своей статьи — «Аналитика»: просмотры, дочитывания, время чтения, источники и UTM-метки.',
      'Ставьте UTM в ссылки из рассылок и соцсетей (?utm_source=…) — увидите, откуда пришли читатели.',
      'Сигналы анти-накрутки показывают, где просмотры настоящие.',
    ],
  },
  {
    icon: BadgePercent,
    title: `Платные статьи с комиссией ${PREMIUM_SALE_FEE_PCT}%`,
    steps: [
      'На шаге «Публикация» включите платный доступ: разовая покупка или подписка на тариф.',
      'До пейволла — тизер: читатель видит начало и решает, покупать ли.',
      `С Premium вам остаётся ${100 - PREMIUM_SALE_FEE_PCT}%* каждой продажи. ${FEE_NOTE}`,
    ],
  },
  {
    icon: FileCode2,
    title: 'Перенос блога с другой площадки',
    steps: [
      'Настройки → Разработчикам → токен с правом articles:write.',
      'POST /api/v1/drafts — каждая статья ложится черновиком; оригинал и дата — в «Перепечатке».',
      'Формат текста и пример запроса — в справочнике API.',
    ],
    link: { to: '/api#article-format', label: 'Формат текста статьи' },
  },
]

const STICKERS: { file: string; label: string }[] = [
  { file: '/brand/weat-mascot.svg', label: 'АТик, цветной (SVG)' },
  { file: '/brand/weat-mascot.png', label: 'АТик, цветной (PNG)' },
  { file: '/brand/weat-mascot-mono.svg', label: 'Одноцветный (SVG)' },
  { file: '/brand/weat-mascot-reverse.svg', label: 'Выворотный (SVG)' },
  { file: '/brand/weat-mascot-guide.pdf', label: 'Гайд по маскоту (PDF)' },
]

function DancingMascot() {
  return (
    <div className="flex justify-center" aria-hidden="true">
      <style>{`
        @keyframes atik-dance {
          0%, 100% { transform: translateY(0) rotate(0deg) scale(1, 1); }
          15% { transform: translateY(-18px) rotate(-8deg) scale(0.96, 1.05); }
          30% { transform: translateY(0) rotate(0deg) scale(1.06, 0.94); }
          45% { transform: translateY(-14px) rotate(8deg) scale(0.97, 1.04); }
          60% { transform: translateY(0) rotate(0deg) scale(1.05, 0.95); }
          80% { transform: translateY(-6px) rotate(-3deg); }
        }
        @keyframes atik-shadow {
          0%, 30%, 60%, 100% { transform: scaleX(1); opacity: .35; }
          15%, 45% { transform: scaleX(.7); opacity: .2; }
        }
        .atik-dance { animation: atik-dance 1.6s ease-in-out infinite; transform-origin: 50% 90%; }
        .atik-shadow { animation: atik-shadow 1.6s ease-in-out infinite; }
        @media (prefers-reduced-motion: reduce) { .atik-dance, .atik-shadow { animation: none; } }
      `}</style>
      <div className="relative flex flex-col items-center">
        <img src="/brand/weat-mascot.svg" alt="" className="atik-dance h-48 w-auto md:h-56" />
        <span className="atik-shadow mt-1 h-3 w-28 rounded-full bg-foreground/40 blur-[2px]" />
      </div>
    </div>
  )
}

export default function AfterPaymentsPage() {
  const { user, isPremium } = useStore()

  // страница для покупателей — поисковикам не нужна (дублирует Caddy X-Robots-Tag и robots.txt)
  useEffect(() => {
    const meta = document.createElement('meta')
    meta.name = 'robots'
    meta.content = 'noindex, nofollow'
    document.head.appendChild(meta)
    const prevTitle = document.title
    document.title = `Спасибо за оплату — ${SITE_NAME}`
    return () => {
      meta.remove()
      document.title = prevTitle
    }
  }, [])

  if (!user || !hasSession()) {
    return (
      <div className="mx-auto max-w-[560px] px-5 py-20 text-center">
        <DancingMascot />
        <h1 className="mt-8 text-3xl font-extrabold tracking-tight">Спасибо за оплату!</h1>
        <p className="mt-3 text-muted-foreground">
          Материалы для покупателей открываются после входа — войдите тем аккаунтом, с которого оплачивали.
        </p>
        <Link to={`/login?${new URLSearchParams({ returnTo: '/after-payments' })}`} className="btn-primary mt-8">
          <LogIn size={15} aria-hidden="true" /> Войти и открыть материалы
        </Link>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-[900px] px-5 pb-24 md:px-8">
      <div className="pt-12 text-center">
        <DancingMascot />
        <p className="meta mt-8">Premium · материалы для покупателей</p>
        <h1 className="mt-2 text-4xl font-extrabold tracking-tight md:text-5xl">Спасибо, {user.name || `@${user.handle}`}!</h1>
        <p className="mx-auto mt-4 max-w-[60ch] text-[15px] leading-relaxed text-muted-foreground">
          АТик танцует в вашу честь. Ниже — гайд по возможностям Premium и стикерпак: используйте их в своих статьях и соцсетях.
        </p>
        {isPremium ? (
          <p className="meta mt-5 inline-flex items-center gap-1.5 border border-dashed border-accent px-3 py-2 text-accent">
            <Sparkles size={12} aria-hidden="true" /> Premium активен
          </p>
        ) : (
          <p className="mx-auto mt-5 max-w-[60ch] border border-dashed border-border bg-secondary/40 p-3 text-sm">
            Оплата обрабатывается — Premium включится в течение нескольких минут, обновите страницу. Не включился за час —{' '}
            <Link to="/support/contact" className="text-accent underline underline-offset-2">напишите в поддержку</Link>, приложите номер заказа из письма.
          </p>
        )}
      </div>

      <section aria-label="Гайд автора Premium" className="mt-14">
        <h2 className="font-mono text-[13px] font-bold uppercase tracking-[0.12em]">Гайд автора Premium</h2>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          {GUIDE.map((g, i) => (
            <Reveal key={g.title} className="border border-border p-5">
              <g.icon size={18} className="text-accent" aria-hidden="true" />
              <h3 className="mt-3 text-lg font-extrabold tracking-tight">
                {i + 1}. {g.title}
              </h3>
              <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm leading-relaxed text-muted-foreground">
                {g.steps.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ol>
              {g.link && (
                <Link to={g.link.to} className="btn-ghost mt-4 !px-3 !py-2 !text-[11px]">
                  <PenLine size={13} aria-hidden="true" /> {g.link.label}
                </Link>
              )}
            </Reveal>
          ))}
        </div>
      </section>

      <section aria-label="Стикерпак АТика" className="mt-14">
        <h2 className="font-mono text-[13px] font-bold uppercase tracking-[0.12em]">Стикерпак АТика</h2>
        <p className="mt-2 max-w-[66ch] text-sm text-muted-foreground">
          Маскот {SITE_NAME} — для обложек, превью и соцсетей. Не меняйте пропорции, выражение лица и фирменные цвета.
        </p>
        <div className="mt-4 grid grid-cols-3 gap-4 sm:grid-cols-3">
          {['/brand/weat-mascot.svg', '/brand/weat-mascot-mono.svg', '/brand/weat-mascot-reverse.svg'].map((src, i) => (
            <div key={src} className={`flex aspect-square items-center justify-center rounded-lg border border-border p-4 ${i === 2 ? 'bg-foreground' : 'bg-secondary/40'}`}>
              <img src={src} alt="" className="h-full w-full object-contain" />
            </div>
          ))}
        </div>
        <ul className="mt-4 flex flex-wrap gap-2">
          {STICKERS.map((s) => (
            <li key={s.file}>
              <a href={s.file} download className="btn-ghost !px-3 !py-2 !text-[11px]">
                <Download size={13} aria-hidden="true" /> {s.label}
              </a>
            </li>
          ))}
        </ul>
      </section>

      <p className="mt-14 text-center text-sm text-muted-foreground">
        Вопросы по оплате или доступу — <Link to="/support/contact" className="text-accent underline underline-offset-2">поддержка</Link>. Хорошего письма!
      </p>
    </div>
  )
}
