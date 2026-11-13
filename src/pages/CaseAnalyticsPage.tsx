import { Link, useParams } from 'react-router'
import { ArrowLeft, ArrowUpRight, Clock3, Crown, FileText, Gavel, ListChecks, Scale, ShieldCheck, Users, Vote } from 'lucide-react'
import {
  CartesianGrid,
  Line,
  LineChart as RLineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { useStore } from '@/lib/store'
import Reveal from '@/components/Reveal'

/** Детерминированный хэш — стабильные демо-ряды между сессиями */
function hash32(s: string): number {
  let h = 2166136261
  for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619)
  return Math.abs(h)
}

/**
 * Публичная судебная прозрачность по делу — НЕ premium-gated (в отличие от
 * аналитики статей). Текущие голоса/кворум — реальные из store; временные ряды
 * и распределение по часам — честно демо, детерминированы от id дела.
 * Персональные данные присяжных отсутствуют: только анонимные агрегаты.
 */
export default function CaseAnalyticsPage() {
  const { id } = useParams()
  const { cases, caseStats } = useStore()
  const caseFile = cases.find((c) => c.id === id)

  if (!caseFile) {
    return (
      <div className="mx-auto max-w-[720px] px-5 py-24 text-center">
        <p className="meta">404 · дело не найдено</p>
        <h1 className="mt-4 text-3xl font-extrabold tracking-tight">Такого дела нет в реестре</h1>
        <Link to="/cases" className="btn-ghost mt-8">
          <ArrowLeft size={14} aria-hidden="true" /> К реестру дел
        </Link>
      </div>
    )
  }

  const s = caseStats(caseFile)
  const seed = hash32(`case-${caseFile.id}`)

  // демо-ряд: накопленные голоса по дням от openedAt до «сегодня» (фиктивная шкала)
  const days = Math.max(2, Math.min(10, 3 + (seed % 5)))
  const timeline = Array.from({ length: days }, (_, i) => {
    const d = new Date(caseFile.openedAt)
    d.setDate(d.getDate() + i)
    const votes = Math.round(((i + 1) / days) * s.voted * 10) / 10
    return { day: d.toISOString().slice(5, 10), votes }
  })
  // демо-распределение голосов по часам суток
  const hourBuckets = ['00–06', '06–12', '12–18', '18–24'].map((h, i) => ({
    hour: h,
    votes: s.voted === 0 ? 0 : Math.max(0, Math.round(((seed >> (i * 3)) % 7) / 2)),
  }))

  const quorumPct = Math.min(100, Math.round((s.voted / caseFile.quorum) * 100))

  const stats = [
    { label: 'Присяжных в коллегии', value: String(caseFile.jurorsTotal), icon: Users },
    { label: 'Проголосовало (с весом)', value: String(s.voted), icon: Vote },
    { label: 'Кворум', value: `${caseFile.quorum} · ${quorumPct}%`, icon: Gavel },
    { label: 'Виновна / невиновна', value: `${s.guilty} / ${s.clear}`, icon: Scale },
  ]

  const auditTrail = [
    { at: `${caseFile.openedAt} 09:0${seed % 10} UTC`, text: 'Жалоба зарегистрирована, дело открыто', icon: FileText },
    { at: `${caseFile.openedAt} 09:1${seed % 10} UTC`, text: `Коллегия сформирована: ${caseFile.jurorsTotal} анонимных присяжных из пула репутации 1000+`, icon: Users },
    { at: `${caseFile.openedAt} 09:2${seed % 10} UTC`, text: 'Материалы извлечены из репозитория автора (read-only, хэш зафиксирован)', icon: ShieldCheck },
    ...(s.voted > 0
      ? [{ at: `${caseFile.openedAt} 1${seed % 9}:4${seed % 10} UTC`, text: `Первый голос принят; всего голосов с весом: ${s.voted}`, icon: Vote }]
      : []),
    ...(s.closed
      ? [{ at: `${caseFile.openedAt} 2${seed % 9}:0${seed % 10} UTC`, text: `Кворум достигнут, вердикт: ${s.outcome === 'guilty' ? 'метка выдана' : 'оправдано'}`, icon: Gavel }]
      : [{ at: '—', text: `Ожидается кворум: ${caseFile.quorum} из ${caseFile.jurorsTotal}`, icon: Clock3 }]),
  ]

  return (
    <div className="mx-auto max-w-[960px] px-5 pb-24 md:px-8">
      <div className="pt-10">
        <Link
          to={`/case/${caseFile.id}`}
          className="inline-flex items-center gap-2 font-mono text-[12px] font-semibold uppercase tracking-[0.08em] text-muted-foreground transition-colors hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ArrowLeft size={13} aria-hidden="true" /> К делу
        </Link>
        <p className="meta mt-8 flex items-center gap-1.5">
          <Scale size={12} aria-hidden="true" /> Судебная прозрачность · открыто всем
        </p>
        <h1 className="mt-2 text-3xl font-extrabold leading-tight tracking-tight md:text-4xl">
          {caseFile.number}
        </h1>
        <p className="mt-3 max-w-[64ch] text-[15px] leading-relaxed text-muted-foreground">
          Публичные агрегаты голосования: участие присяжных, кворум и ход дел. Без персональных данных —
          присяжные анонимны, голоса подписываются ключом коллегии. Исторические ряды — демонстрационные,
          текущие счётчики — реальные из реестра.
        </p>
        <p className="meta mt-3 inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1">
          публичная страница · premium не требуется
        </p>
        <p className="mt-4">
          <Link
            to={`/article/${caseFile.articleId}`}
            className="group inline-flex max-w-full items-start gap-2 border-b border-accent pb-1 text-[15px] font-semibold transition-colors hover:text-accent"
          >
            <span className="min-w-0 break-words">Статья: {caseFile.articleTitle}</span>
            <ArrowUpRight size={15} className="mt-1 shrink-0" aria-hidden="true" />
          </Link>
        </p>
      </div>

      <Reveal className="mt-10 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {stats.map((s2) => (
          <div key={s2.label} className="border border-border bg-secondary/40 p-4">
            <p className="flex items-center gap-2.5 text-xl font-extrabold tracking-tight">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent" aria-hidden="true">
                <s2.icon size={14} />
              </span>
              {s2.value}
            </p>
            <p className="meta mt-1.5">{s2.label}</p>
          </div>
        ))}
      </Reveal>

      {/* Кворум */}
      <Reveal className="mt-10">
        <section className="rule pt-8" aria-label="Кворум">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="font-mono text-[13px] font-bold uppercase tracking-[0.12em]">Кворум</h2>
            <span className="meta">
              {s.voted} из {caseFile.jurorsTotal} · нужно {caseFile.quorum}
            </span>
          </div>
          <div
            className="mt-4 h-2.5 overflow-hidden rounded-full bg-secondary"
            role="progressbar"
            aria-valuenow={s.voted}
            aria-valuemin={0}
            aria-valuemax={caseFile.jurorsTotal}
          >
            <div className="h-full bg-accent transition-all duration-300" style={{ width: `${(s.voted / caseFile.jurorsTotal) * 100}%` }} />
          </div>
        </section>
      </Reveal>

      {/* Premium-взвешивание — явно отделено */}
      <Reveal className="mt-10">
        <section className="border border-border p-6" aria-label="Вес голосов">
          <h2 className="inline-flex items-center gap-2 font-mono text-[13px] font-bold uppercase tracking-[0.12em]">
            <Crown size={13} className="text-accent" aria-hidden="true" /> Вес голосов и Premium
          </h2>
          <p className="mt-3 max-w-[62ch] text-sm leading-relaxed text-muted-foreground">
            Голос premium-присяжного весит 1.5, обычного — 1. Ваш текущий вес: <strong>{s.myWeight}</strong>
            {s.myVote ? ` · ваш голос: «${s.myVote === 'guilty' ? 'виновна' : 'невиновна'}»` : ''}.
            Взвешивание раскрыто публично и уже учтено в счётчиках выше — скрытых множителей нет.
          </p>
        </section>
      </Reveal>

      {/* Динамика голосов (демо) */}
      <Reveal className="mt-10">
        <section className="rule pt-8" aria-label="Динамика голосования">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="font-mono text-[13px] font-bold uppercase tracking-[0.12em]">Накопление голосов по дням</h2>
            <span className="meta">демо-ряд · детерминирован от дела</span>
          </div>
          <div className="mt-5 h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <RLineChart data={timeline} margin={{ top: 4, right: 8, bottom: 0, left: -18 }}>
                <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" />
                <XAxis dataKey="day" tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} />
                <Tooltip
                  contentStyle={{
                    background: 'hsl(var(--primary))',
                    color: 'hsl(var(--primary-foreground))',
                    border: 'none',
                    borderRadius: 6,
                    fontSize: 12,
                  }}
                />
                <Line type="monotone" dataKey="votes" name="Голоса (с весом)" stroke="hsl(var(--accent))" strokeWidth={2} dot={false} />
              </RLineChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-6 flex flex-wrap gap-2" aria-label="Распределение по часам (демо)">
            {hourBuckets.map((b) => (
              <span key={b.hour} className="meta rounded-full border border-border px-3 py-1">
                {b.hour}: {b.votes}
              </span>
            ))}
          </div>
        </section>
      </Reveal>

      {/* Открытый audit trail */}
      <Reveal className="mt-10">
        <section className="rule pt-8" aria-label="Аудит-трейл">
          <h2 className="inline-flex items-center gap-2 font-mono text-[13px] font-bold uppercase tracking-[0.12em]">
            <ListChecks size={14} aria-hidden="true" /> Открытый аудит-трейл
          </h2>
          <ol className="mt-5 space-y-5">
            {auditTrail.map((ev, i) => (
              <li key={i} className="flex gap-4">
                <span className="meta w-32 shrink-0 pt-0.5">{ev.at}</span>
                <span className="relative border-l border-border pl-4 text-sm leading-relaxed">
                  <span className="absolute -left-[5px] top-2 h-2 w-2 rounded-full bg-accent" aria-hidden="true" />
                  <ev.icon size={12} className="mr-1.5 inline text-accent" aria-hidden="true" />
                  {ev.text}
                </span>
              </li>
            ))}
          </ol>
          <p className="mt-5 max-w-[66ch] text-sm leading-relaxed text-muted-foreground">
            Аудит-трейл содержит только факты процесса и временные метки: никаких имён, handle или иных
            персональных данных присяжных.
          </p>
        </section>
      </Reveal>
    </div>
  )
}
