import { Link } from 'react-router'
import { ArrowLeft, LineChart, Lock, Pause, Play, Wallet } from 'lucide-react'
import Reveal from '@/components/Reveal'
import { useStore } from '@/lib/store'

type CampaignStatus = 'active' | 'paused' | 'done'

interface DashboardCampaign {
  id: string
  name: string
  status: CampaignStatus
  budget: number
  spent: number
  clicks: number
  impressions: number
}

const statusMeta: Record<CampaignStatus, { label: string; className: string }> = {
  active: { label: 'Активна', className: 'border-accent/70 text-accent' },
  paused: { label: 'На паузе', className: 'border-border text-muted-foreground' },
  done: { label: 'Завершена', className: 'border-border text-muted-foreground' },
}

const campaigns: DashboardCampaign[] = [
  { id: 'camp-1', name: 'Трекер задач для инженеров', status: 'active', budget: 30000, spent: 12400, clicks: 3120, impressions: 130000 },
  { id: 'camp-2', name: 'Облачный CI для студий', status: 'paused', budget: 15000, spent: 8300, clicks: 1490, impressions: 82800 },
  { id: 'camp-3', name: 'Курс по миграции на AT Protocol', status: 'done', budget: 20000, spent: 20000, clicks: 5140, impressions: 214000 },
]

function ctr(c: DashboardCampaign): string {
  return `${((c.clicks / c.impressions) * 100).toFixed(1)}%`
}

function rub(n: number): string {
  return `${n.toLocaleString('ru-RU')} ₽`
}

/**
 * Личный кабинет рекламодателя: обзор кампаний, бюджеты, CTR.
 * Демо-прототип: данные моковые, платежей и списаний нет.
 */
export default function AdvertiserDashboardPage() {
  const { user } = useStore()

  // Кабинет только для авторизованных: гость видит auth gate, данные не отдаём
  if (!user) {
    return (
      <div className="mx-auto max-w-[720px] px-5 py-24 text-center">
        <Lock size={22} className="mx-auto text-accent" aria-hidden="true" />
        <p className="meta mt-4">Личный кабинет рекламодателя</p>
        <h1 className="mt-4 text-3xl font-extrabold tracking-tight">Нужна авторизация</h1>
        <p className="mx-auto mt-3 max-w-[48ch] text-muted-foreground">
          Бюджеты и статистика кампаний привязаны к аккаунту. Войдите — вернём вас сюда сразу после входа.
        </p>
        <Link to="/login?returnTo=/ads/dashboard" className="btn-primary mt-8">
          Войти
        </Link>
      </div>
    )
  }

  const totalBudget = campaigns.reduce((s, c) => s + c.budget, 0)
  const totalSpent = campaigns.reduce((s, c) => s + c.spent, 0)
  const totalClicks = campaigns.reduce((s, c) => s + c.clicks, 0)

  return (
    <div className="mx-auto max-w-[960px] px-5 pb-24 md:px-8">
      <div className="pt-10">
        <Link
          to="/ads"
          className="inline-flex items-center gap-2 font-mono text-[12px] font-semibold uppercase tracking-[0.08em] text-muted-foreground transition-colors hover:text-accent"
        >
          <ArrowLeft size={13} aria-hidden="true" /> Рекламодателям
        </Link>
        <p className="meta mt-8 flex items-center gap-1.5">
          <LineChart size={12} aria-hidden="true" /> Кабинет · демо-данные, платежей нет
        </p>
        <h1 className="mt-2 text-4xl font-extrabold tracking-tight md:text-5xl">Личный кабинет рекламодателя</h1>
        <p className="mt-4 max-w-[64ch] text-[15px] leading-relaxed text-muted-foreground">
          Обзор ваших кампаний: статусы, бюджеты и CTR. Запуск и редактирование кампаний — на странице «Рекламодателям».
        </p>
      </div>

      <Reveal className="mt-10 grid gap-3 sm:grid-cols-3">
        <div className="border border-border bg-secondary/40 p-5">
          <p className="meta inline-flex items-center gap-1.5"><Wallet size={12} aria-hidden="true" /> Бюджет</p>
          <p className="mt-2 text-2xl font-extrabold tracking-tight">{rub(totalBudget)}</p>
          <p className="meta mt-1">израсходовано {rub(totalSpent)}</p>
        </div>
        <div className="border border-border bg-secondary/40 p-5">
          <p className="meta">Клики</p>
          <p className="mt-2 text-2xl font-extrabold tracking-tight">{totalClicks.toLocaleString('ru-RU')}</p>
          <p className="meta mt-1">по всем кампаниям</p>
        </div>
        <div className="border border-border bg-secondary/40 p-5">
          <p className="meta">Кампании</p>
          <p className="mt-2 text-2xl font-extrabold tracking-tight">{campaigns.length}</p>
          <p className="meta mt-1">активных: {campaigns.filter((c) => c.status === 'active').length}</p>
        </div>
      </Reveal>

      <div className="mt-10">
        {campaigns.map((c) => {
          const st = statusMeta[c.status]
          const spentPct = Math.min(100, (c.spent / c.budget) * 100)
          return (
            <Reveal key={c.id}>
              <article className="rule py-6 first:border-t-0">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h2 className="text-lg font-extrabold tracking-tight">{c.name}</h2>
                  <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[11px] font-semibold uppercase tracking-[0.06em] ${st.className}`}>
                    {c.status === 'active' ? <Play size={10} aria-hidden="true" /> : <Pause size={10} aria-hidden="true" />}
                    {st.label}
                  </span>
                </div>
                <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1">
                  <span className="meta">Бюджет {rub(c.budget)}</span>
                  <span className="meta">Потрачено {rub(c.spent)}</span>
                  <span className="meta">CTR {ctr(c)}</span>
                  <span className="meta">{c.impressions.toLocaleString('ru-RU')} показов</span>
                </div>
                <div
                  className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-secondary"
                  role="progressbar"
                  aria-label={`Израсходовано ${Math.round(spentPct)}% бюджета`}
                  aria-valuenow={Math.round(spentPct)}
                  aria-valuemin={0}
                  aria-valuemax={100}
                >
                  <div className="h-full bg-accent" style={{ width: `${spentPct}%` }} />
                </div>
              </article>
            </Reveal>
          )
        })}
      </div>

      <p className="meta mt-8">Демонстрационный кабинет прототипа: цифры моковые, списаний и платежей не происходит.</p>
    </div>
  )
}
