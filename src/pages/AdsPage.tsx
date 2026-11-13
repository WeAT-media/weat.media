import { useState } from 'react'
import { Link } from 'react-router'
import { ArrowLeft, BadgePercent, Eye, LineChart, Plus, ShieldCheck, Users } from 'lucide-react'
import {
  LineChart as RLineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts'
import { useStore } from '@/lib/store'
import Reveal from '@/components/Reveal'
import AdCreativeEditor from '@/components/AdCreativeEditor'

const ctrSeries = [
  { day: 'Пн', ctr: 1.8, retention: 42 },
  { day: 'Вт', ctr: 2.1, retention: 45 },
  { day: 'Ср', ctr: 1.6, retention: 47 },
  { day: 'Чт', ctr: 2.4, retention: 51 },
  { day: 'Пт', ctr: 3.1, retention: 55 },
  { day: 'Сб', ctr: 2.7, retention: 49 },
  { day: 'Вс', ctr: 2.2, retention: 53 },
]

interface Campaign {
  id: string
  name: string
  spent: number
  clicks: number
  ctr: string
  erid: string
}

const seedCampaigns: Campaign[] = [
  { id: 'ad1', name: 'Трекер задач для инженеров', spent: 12400, clicks: 3120, ctr: '2.4%', erid: '2VtzqW7EKb6' },
  { id: 'ad2', name: 'Облачный CI для студий', spent: 8300, clicks: 1490, ctr: '1.8%', erid: '2VtzxP4MNd2' },
]

/** Рекламный кабинет: кампании, метрики CTR/удержания, маркировка рекламы */
export default function AdsPage() {
  const { isPremium } = useStore()
  const [campaigns, setCampaigns] = useState<Campaign[]>(seedCampaigns)

  const addCampaign = () => {
    const n = campaigns.length + 1
    setCampaigns([
      {
        id: `ad-${Date.now()}`,
        name: `Новая кампания #${n}`,
        spent: 0,
        clicks: 0,
        ctr: '—',
        erid: `2Vtz${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
      },
      ...campaigns,
    ])
  }

  return (
    <div className="mx-auto max-w-[1100px] px-5 pb-24 md:px-8">
      <div className="flex flex-wrap items-end justify-between gap-4 pb-8 pt-10">
        <div>
          <Link
            to="/feed"
            className="inline-flex items-center gap-2 font-mono text-[12px] font-semibold uppercase tracking-[0.08em] text-muted-foreground transition-colors hover:text-accent"
          >
            <ArrowLeft size={13} aria-hidden="true" /> Лента
          </Link>
          <p className="meta mt-6">Рекламный кабинет</p>
          <h1 className="mt-2 text-4xl font-extrabold tracking-tight md:text-5xl">Реклама</h1>
          <p className="mt-4 max-w-[64ch] text-[15px] leading-relaxed text-muted-foreground">
            Метрики BigData-движка: CTR креативов и удержание аудитории. Вся реклама маркируется по 38-ФЗ
            «О рекламе» (erid), Premium-пользователи рекламу не видят вовсе.
          </p>
        </div>
        <button onClick={addCampaign} className="btn-primary">
          <Plus size={14} aria-hidden="true" /> Новая кампания
        </button>
      </div>

      {/* метрики */}
      <div className="grid gap-4 sm:grid-cols-3">
        {[
          { label: 'Средний CTR', value: '2.3%', hint: '+0.4 за неделю', icon: BadgePercent },
          { label: 'Удержание', value: '49%', hint: 'дочитываемость ленты', icon: Users },
          { label: 'Показы (7 дн)', value: '184k', hint: 'без premium-скрытий: 210k', icon: Eye },
        ].map((m) => (
          <Reveal key={m.label} className="border border-border bg-secondary/40 p-5">
            <p className="flex items-center gap-2.5 text-3xl font-extrabold tracking-tight">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent" aria-hidden="true">
                <m.icon size={16} />
              </span>
              {m.value}
            </p>
            <p className="meta mt-2">{m.label}</p>
            <p className="meta mt-1">{m.hint}</p>
          </Reveal>
        ))}
      </div>

      {/* график */}
      <Reveal className="mt-8 border border-border bg-secondary/40 p-6">
        <p className="meta inline-flex items-center gap-1.5">
          <LineChart size={12} aria-hidden="true" /> CTR и удержание по дням
        </p>
        <div className="mt-4 h-64">
          <ResponsiveContainer width="100%" height="100%">
            <RLineChart data={ctrSeries} margin={{ top: 8, right: 16, bottom: 0, left: -18 }}>
              <CartesianGrid stroke="hsl(27 36% 80%)" strokeDasharray="3 3" />
              <XAxis dataKey="day" stroke="hsl(25 8% 40%)" fontSize={12} fontFamily="JetBrains Mono" />
              <YAxis stroke="hsl(25 8% 40%)" fontSize={12} fontFamily="JetBrains Mono" />
              <Tooltip
                contentStyle={{
                  background: 'hsl(26 41% 97%)',
                  border: '1px solid hsl(27 36% 80%)',
                  borderRadius: 6,
                  fontSize: 13,
                }}
              />
              <Legend />
              <Line type="monotone" dataKey="ctr" name="CTR, %" stroke="hsl(27 50% 49%)" strokeWidth={2} dot={{ r: 3 }} />
              <Line type="monotone" dataKey="retention" name="Удержание, %" stroke="hsl(25 6% 22%)" strokeWidth={2} dot={{ r: 3 }} />
            </RLineChart>
          </ResponsiveContainer>
        </div>
      </Reveal>

      {/* кампании */}
      <Reveal className="mt-8">
        <table className="w-full text-left text-[15px]">
          <caption className="meta pb-3 text-left">
            <ShieldCheck size={11} className="mr-1 inline text-accent" aria-hidden="true" />
            Кампании · все объявления снабжены erid и пометкой «Реклама»
          </caption>
          <thead>
            <tr className="rule">
              <th className="py-3 pr-4 font-mono text-[12px] font-semibold uppercase tracking-[0.08em]">Название</th>
              <th className="py-3 pr-4 font-mono text-[12px] font-semibold uppercase tracking-[0.08em]">Потрачено</th>
              <th className="py-3 pr-4 font-mono text-[12px] font-semibold uppercase tracking-[0.08em]">Клики</th>
              <th className="py-3 pr-4 font-mono text-[12px] font-semibold uppercase tracking-[0.08em]">CTR</th>
              <th className="py-3 font-mono text-[12px] font-semibold uppercase tracking-[0.08em]">erid</th>
            </tr>
          </thead>
          <tbody>
            {campaigns.map((c) => (
              <tr key={c.id} className="rule">
                <td className="py-3.5 pr-4 font-medium">{c.name}</td>
                <td className="py-3.5 pr-4">{c.spent.toLocaleString('ru-RU')} ₽</td>
                <td className="py-3.5 pr-4">{c.clicks.toLocaleString('ru-RU')}</td>
                <td className="py-3.5 pr-4">{c.ctr}</td>
                <td className="py-3.5 font-mono text-[12px] text-muted-foreground">{c.erid}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {isPremium && (
          <p className="meta mt-4">Ваш аккаунт Premium — в ленте и статьях реклама для вас скрыта полностью.</p>
        )}
      </Reveal>

      <AdCreativeEditor />
    </div>
  )
}
