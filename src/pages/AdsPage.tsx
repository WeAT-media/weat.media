import { useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { ArrowLeft, BadgePercent, Eye, EyeOff, LineChart, Pin, Plus, Users } from 'lucide-react'
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
import { AdView } from '@/components/AdBanner'
import { countryLabel } from '@/lib/api'
import { AD_AUDIENCE_LABEL, AD_STATUSES, AD_STATUS_LABEL, PIN_APPROVAL_LABEL, loadAds, matchesGeo, needsErid, type AdCreative, type AdStatus } from '@/lib/ads'
import CountrySelect from '@/components/CountrySelect'

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
  /** нет — кампания вне РФ, маркировка не нужна */
  erid?: string
}

const seedCampaigns: Campaign[] = [
  { id: 'ad1', name: 'Трекер задач для инженеров', spent: 12400, clicks: 3120, ctr: '2.4%', erid: '2VtzqW7EKb6' },
  { id: 'ad2', name: 'Облачный CI для студий', spent: 8300, clicks: 1490, ctr: '1.8%', erid: '2VtzxP4MNd2' },
]

const geoSummary = (a: AdCreative) => {
  const parts = [
    a.geo.residence.length ? `живут: ${a.geo.residence.map((c) => countryLabel(c)).join(', ')}` : '',
    a.geo.registration.length ? `рег.: ${a.geo.registration.map((c) => countryLabel(c)).join(', ')}` : '',
  ].filter(Boolean)
  return parts.length ? parts.join(' · ') : 'все страны'
}

/** Рекламный кабинет: кампании, метрики CTR/удержания, история креативов и публичная доска */
export default function AdsPage() {
  const { isPremium } = useStore()
  const [params] = useSearchParams()
  const [campaigns, setCampaigns] = useState<Campaign[]>(seedCampaigns)
  const [ads, setAds] = useState<AdCreative[]>(loadAds)
  const [filter, setFilter] = useState<AdStatus | 'all'>('all')
  const history = [...ads].filter((a) => filter === 'all' || a.status === filter).sort((x, y) => y.createdAt.localeCompare(x.createdAt))
  // доска видна всем: креативы, кроме скрытых за доплату. Фильтр — «что увидит читатель из этих стран»:
  // сначала нацеленные именно на них, потом показы на все страны
  const [boardStatus, setBoardStatus] = useState<AdStatus | 'all'>('all')
  const [boardResidence, setBoardResidence] = useState<string[]>([])
  const [boardRegistration, setBoardRegistration] = useState<string[]>([])
  const viewer = { residence: boardResidence[0], registration: boardRegistration[0] }
  const targeted = (a: AdCreative) =>
    (!!viewer.residence && a.geo.residence.includes(viewer.residence)) || (!!viewer.registration && a.geo.registration.includes(viewer.registration))
  const board = ads
    .filter((a) => !a.hiddenFromBoard)
    .filter((a) => boardStatus === 'all' || a.status === boardStatus)
    .filter((a) => (!viewer.residence && !viewer.registration) || matchesGeo(a.geo, viewer))
    .sort((x, y) => Number(targeted(y)) - Number(targeted(x)))

  const addCampaign = () => {
    const n = campaigns.length + 1
    setCampaigns([
      {
        id: `ad-${Date.now()}`,
        name: `Новая кампания #${n}`,
        spent: 0,
        clicks: 0,
        ctr: '—',
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
            CTR креативов, удержание аудитории, гео по стране резидентства и регистрации. Premium-читатели рекламу не
            видят.
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
            Кампании · пометка «Реклама» — у всех, erid — у показов в РФ
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
                <td className="py-3.5 font-mono text-[12px] text-muted-foreground">{c.erid ?? 'вне РФ'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {isPremium && (
          <p className="meta mt-4">Ваш аккаунт Premium — в ленте и статьях реклама для вас скрыта полностью.</p>
        )}
      </Reveal>

      <AdCreativeEditor onChange={setAds} initialId={params.get('edit') ?? undefined} />

      {/* история креативов */}
      <Reveal className="mt-10">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-xl font-extrabold tracking-tight">История креативов</h2>
          <div role="group" aria-label="Статус" className="flex flex-wrap rounded-full border border-border bg-secondary/60 p-0.5">
            {(['all', ...AD_STATUSES] as const).map((s) => (
              <button
                key={s}
                type="button"
                aria-pressed={filter === s}
                onClick={() => setFilter(s)}
                className={`cursor-pointer rounded-full px-3 py-1 font-mono text-[11px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  filter === s ? 'bg-primary text-primary-foreground' : 'text-foreground hover:text-accent'
                }`}
              >
                {s === 'all' ? `Все · ${ads.length}` : `${AD_STATUS_LABEL[s]} · ${ads.filter((a) => a.status === s).length}`}
              </button>
            ))}
          </div>
        </div>
        {history.length === 0 ? (
          <p className="rule mt-4 py-8 text-sm text-muted-foreground">Креативов с таким статусом нет.</p>
        ) : (
          <ul className="mt-4">
            {history.map((a) => (
              <li key={a.id} className="rule flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-3.5">
                <span className="min-w-0">
                  <span className="font-semibold">{a.title || 'без названия'}</span>
                  <span className="meta ml-2 !normal-case tracking-normal">
                    {a.advertiser} · {AD_AUDIENCE_LABEL[a.audience]} · {geoSummary(a)}
                    {a.pinnedTo && <> · <Pin size={10} className="inline" aria-hidden="true" /> {a.pinnedTo.title} ({PIN_APPROVAL_LABEL[a.pinnedTo.approval]})</>}
                    {a.hiddenFromBoard && <> · <EyeOff size={10} className="inline" aria-hidden="true" /> скрыт с доски</>}
                  </span>
                </span>
                <span className="meta shrink-0">
                  {needsErid(a.geo) ? `erid ${a.erid ?? '— нужен!'}` : 'вне РФ'} ·{' '}
                  <span className={a.status === 'running' || a.status === 'prolonged' ? 'text-accent' : ''}>{AD_STATUS_LABEL[a.status]}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Reveal>

      {/* публичная доска: прозрачность — кто и что рекламирует */}
      <Reveal className="mt-10">
        <h2 className="text-xl font-extrabold tracking-tight">Доска креативов</h2>
        <p className="mt-1 max-w-[64ch] text-sm text-muted-foreground">
          Видна всем: кто и что рекламирует на площадке. Креатив можно скрыть с доски за доплату — в статьях он
          показывается как обычно.
        </p>
        <div role="group" aria-label="Статус на доске" className="mt-4 flex w-fit flex-wrap rounded-full border border-border bg-secondary/60 p-0.5">
          {(['all', ...AD_STATUSES] as const).map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={boardStatus === s}
              onClick={() => setBoardStatus(s)}
              className={`cursor-pointer rounded-full px-3 py-1 font-mono text-[11px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                boardStatus === s ? 'bg-primary text-primary-foreground' : 'text-foreground hover:text-accent'
              }`}
            >
              {s === 'all' ? 'Все' : AD_STATUS_LABEL[s]}
            </button>
          ))}
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1 text-sm">
            Читатель живёт в
            <CountrySelect label="Страна резидентства читателя" placeholder="Любая страна" value={boardResidence} onChange={setBoardResidence} />
          </div>
          <div className="grid gap-1 text-sm">
            Зарегистрирован в
            <CountrySelect label="Страна регистрации читателя" placeholder="Любая страна" value={boardRegistration} onChange={setBoardRegistration} />
          </div>
        </div>
        {(viewer.residence || viewer.registration) && (
          <p className="meta mt-2 !normal-case tracking-normal">
            Креативы, которые увидит такой читатель: сначала нацеленные на эти страны, затем показы на все страны.
          </p>
        )}
        {board.length === 0 ? (
          <p className="rule mt-4 py-8 text-sm text-muted-foreground">
            {viewer.residence || viewer.registration ? 'Такому читателю сейчас ничего не показывается.' : 'На доске пока пусто.'}
          </p>
        ) : (
          <div className="mt-2 grid gap-x-6 md:grid-cols-2">
            {board.map((a) => (
              <div key={a.id}>
                <p className="meta mt-6">{AD_STATUS_LABEL[a.status]} · {AD_AUDIENCE_LABEL[a.audience]} · {geoSummary(a)}</p>
                <AdView ad={a} />
              </div>
            ))}
          </div>
        )}
      </Reveal>
    </div>
  )
}
