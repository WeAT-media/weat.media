import { Link, useParams } from 'react-router'
import { ArrowLeft, ArrowBigUp, BookOpen, CheckCircle2, Clock, Crown, Eye, LineChart, MessageSquare, MousePointerClick, ShieldAlert, ShieldCheck, Users } from 'lucide-react'
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
import { EMPTY_STATS, fromRealStats, getArticleAnalytics, upvoteCount as countUpvotes } from '@/lib/analytics'
import { useArticleStats } from '@/lib/tracking'
import { normalizeVideos } from '@/lib/videos'
import { normalizeAtProto } from '@/lib/atproto'
import Reveal from '@/components/Reveal'
import PollAnalytics from '@/components/PollAnalytics'
import { SITE_NAME } from '@/config/site'

/** Детерминированные демо-метрики видео по id (только native — своя телеметрия) */
function videoSeed(id: string): number {
  let h = 2166136261
  for (const ch of id) h = Math.imul(h ^ ch.charCodeAt(0), 16777619)
  return Math.abs(h)
}

function fmtTime(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return m > 0 ? `${m} мин ${s} с` : `${s} с`
}

/**
 * Open Analytics: открытые метрики статьи (агрегаты, без персональных данных).
 * Автор видит свои записи без Premium; остальные пользователи — по подписке.
 */
export default function ArticleAnalyticsPage() {
  const { id } = useParams()
  const { articles, upvotes, user, isPremium } = useStore()
  const article = articles.find((a) => a.id === id)
  const isAuthor = !!user && !!article && (user.did === article.author.did || user.handle === article.author.handle)
  const real = useArticleStats(article?.id)

  if (!article) {
    return (
      <div className="mx-auto max-w-[720px] px-5 py-24 text-center">
        <p className="meta">404 · запись не найдена</p>
        <Link to="/feed" className="btn-ghost mt-8">
          <ArrowLeft size={14} aria-hidden="true" /> К ленте
        </Link>
      </div>
    )
  }

  // Гейт до вычисления и рендера метрик: данные аналитики не попадают в DOM
  if (!user || (!isPremium && !isAuthor)) {
    return (
      <div className="mx-auto max-w-[720px] px-5 py-24">
        <Link
          to={`/article/${article.id}`}
          className="inline-flex items-center gap-2 font-mono text-[12px] font-semibold uppercase tracking-[0.08em] text-muted-foreground transition-colors hover:text-accent"
        >
          <ArrowLeft size={13} aria-hidden="true" /> К записи
        </Link>
        <div className="mt-10 border-2 border-dashed border-accent/60 bg-secondary/50 p-8 text-center">
          <p className="meta inline-flex items-center justify-center gap-1.5 text-accent">
            <Crown size={12} aria-hidden="true" /> Открытая аналитика · Premium
          </p>
          <h1 className="mt-4 text-3xl font-extrabold tracking-tight">
            {user ? 'Открытые метрики — для Premium' : 'Войдите, чтобы увидеть открытые метрики'}
          </h1>
          <p className="mx-auto mt-3 max-w-[52ch] text-[15px] leading-relaxed text-muted-foreground">
            Открытая аналитика — публичные агрегаты записи (просмотры, дочитывания, сигналы анти-накрутки) —
            доступна подписчикам Premium. {user ? 'Данные записи здесь не показываются до оформления подписки.' : 'Сначала войдите в аккаунт.'}
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            {!user && (
              <Link to={`/login?returnTo=${encodeURIComponent(`/article/${article.id}/analytics`)}`} className="btn-primary !px-4 !py-2">
                Войти
              </Link>
            )}
            <Link to="/premium" className={user ? 'btn-primary !px-4 !py-2' : 'btn-ghost !px-4 !py-2'}>
              Оформить Premium
            </Link>
          </div>
        </div>
      </div>
    )
  }

  const upvoteCount = countUpvotes(article, upvotes.includes(article.id))
  // статья из сети — только реальные данные сервиса (нет просмотров — нули); модель — лишь у демо-статей
  const demo = !article.fromIndex && !real
  const an = real ? fromRealStats(article, upvoteCount, real) : demo ? getArticleAnalytics(article, upvoteCount) : fromRealStats(article, upvoteCount, EMPTY_STATS)

  const stats = [
    { label: 'Просмотры', value: an.views.toLocaleString('ru-RU'), icon: Eye },
    { label: 'Уникальные зрители ≈', value: an.uniqueViewers.toLocaleString('ru-RU'), icon: Users },
    { label: 'Среднее время чтения', value: fmtTime(an.avgReadTimeSec), icon: Clock },
    { label: 'Дочитывания', value: `${an.completionPct}%`, icon: BookOpen },
    { label: 'Подняли', value: an.upvotes.toLocaleString('ru-RU'), icon: ArrowBigUp },
    { label: 'Комментарии', value: String(an.comments), icon: MessageSquare },
    { label: 'CTR из ленты', value: an.ctrPct === null ? '—' : `${an.ctrPct}%`, icon: MousePointerClick },
  ]

  return (
    <div className="mx-auto max-w-[960px] px-5 pb-24 md:px-8">
      <div className="pt-10">
        <Link
          to={`/article/${article.id}`}
          className="inline-flex items-center gap-2 font-mono text-[12px] font-semibold uppercase tracking-[0.08em] text-muted-foreground transition-colors hover:text-accent"
        >
          <ArrowLeft size={13} aria-hidden="true" /> К записи
        </Link>
        <p className="meta mt-8 flex items-center gap-1.5">
          <LineChart size={12} aria-hidden="true" /> Открытая аналитика
        </p>
        <h1 className="mt-2 text-3xl font-extrabold leading-tight tracking-tight md:text-4xl">{article.title}</h1>
        <p className="mt-3 max-w-[64ch] text-[15px] leading-relaxed text-muted-foreground">
          Публичные агрегаты помогают оценить вовлечённость и заметить возможную накрутку. Это приблизительная
          модель: просмотры и зрители оцениваются по сессиям и псевдонимным техническим сигналам.
        </p>
        <p className="meta mt-3 inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1">
          открытые метрики · {isAuthor ? 'ваша запись' : 'доступ Premium'}
        </p>
        <p className={`meta mt-2 ${an.real ? 'text-accent' : 'text-muted-foreground'}`} role="status">
          {real === undefined ? 'загружаем данные…' : an.real ? 'реальные данные · без cookie и IP' : 'демо-данные: реальных просмотров пока нет'}
        </p>
        {/* Происхождение записи и область метрик */}
        <div className="mt-5 max-w-[64ch] border border-dashed border-border bg-secondary/40 p-4">
          <p className="meta">Источник и область данных</p>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            Запись: <span className="font-mono text-[12px]">{normalizeAtProto(article).originPds}</span> · тип:{' '}
            {normalizeAtProto(article).sourceType} · индексирована {normalizeAtProto(article).indexedAt}.
            Это метрики {SITE_NAME}, а не всей ATmosphere — другие AppView считают своё.
          </p>
        </div>
      </div>

      {/* Агрегаты */}
      <Reveal className="mt-10 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className="border border-border bg-secondary/40 p-4">
            <p className="flex items-center gap-2.5 text-xl font-extrabold tracking-tight">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent" aria-hidden="true">
                <s.icon size={14} />
              </span>
              {s.value}
            </p>
            <p className="meta mt-1.5">{s.label}</p>
          </div>
        ))}
      </Reveal>

      {/* Динамика */}
      <Reveal className="mt-10">
        <section className="rule pt-8" aria-label="Динамика по дням">
          <h2 className="font-mono text-[13px] font-bold uppercase tracking-[0.12em]">Динамика за 14 дней</h2>
          <div className="mt-5 h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <RLineChart data={an.daily} margin={{ top: 4, right: 8, bottom: 0, left: -18 }}>
                <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" />
                <XAxis dataKey="day" tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} />
                <YAxis tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} />
                <Tooltip
                  contentStyle={{
                    background: 'hsl(var(--primary))',
                    color: 'hsl(var(--primary-foreground))',
                    border: 'none',
                    borderRadius: 6,
                    fontSize: 12,
                  }}
                />
                <Line type="monotone" dataKey="views" name="Просмотры" stroke="hsl(var(--accent))" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="completedReads" name="Дочитывания" stroke="hsl(var(--muted-foreground))" strokeWidth={1.5} strokeDasharray="5 4" dot={false} />
              </RLineChart>
            </ResponsiveContainer>
          </div>
        </section>
      </Reveal>

      {/* Источники */}
      <Reveal className="mt-10">
        <section className="rule pt-8" aria-label="Источники трафика">
          <h2 className="font-mono text-[13px] font-bold uppercase tracking-[0.12em]">Источники трафика</h2>
          <div className="mt-5 space-y-3">
            {an.sources.map((s) => (
              <div key={s.name}>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm">{s.name}</span>
                  <span className="meta">{s.pct}%</span>
                </div>
                <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-secondary">
                  <div className="h-full bg-accent" style={{ width: `${s.pct}%` }} />
                </div>
              </div>
            ))}
          </div>
        </section>
      </Reveal>

      {an.utm.length > 0 && (
        <Reveal className="mt-10">
          <section className="rule pt-8" aria-label="UTM-метки">
            <h2 className="font-mono text-[13px] font-bold uppercase tracking-[0.12em]">UTM-метки</h2>
            <table className="mt-5 w-full text-sm">
              <thead>
                <tr className="meta text-left">
                  <th className="pb-2 font-normal">utm_source</th>
                  <th className="pb-2 font-normal">utm_medium</th>
                  <th className="pb-2 font-normal">utm_campaign</th>
                  <th className="pb-2 text-right font-normal">Просмотры</th>
                </tr>
              </thead>
              <tbody>
                {an.utm.map((u) => (
                  <tr key={`${u.source}|${u.medium}|${u.campaign}`} className="border-t border-border">
                    <td className="py-2 font-mono text-[13px]">{u.source}</td>
                    <td className="py-2 font-mono text-[13px] text-muted-foreground">{u.medium || '—'}</td>
                    <td className="py-2 font-mono text-[13px] text-muted-foreground">{u.campaign || '—'}</td>
                    <td className="py-2 text-right">{u.views.toLocaleString('ru-RU')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </Reveal>
      )}

      {an.canvasFingerprints.length > 0 && (
        <Reveal className="mt-10">
          <section className="rule pt-8" aria-label="Canvas-сигнатуры устройств">
            <h2 className="font-mono text-[13px] font-bold uppercase tracking-[0.12em]">Canvas-сигнатуры</h2>
            <p className="mt-3 max-w-[68ch] text-sm leading-relaxed text-muted-foreground">
              Первые 12 hex-символов SHA-256 открытой canvas-отрисовки. Одинаковые подписи группируют похожие
              графические окружения, но не раскрывают и не доказывают ОС, её версию или модель устройства.
              <Link to="/legal/cookies" className="ml-1 text-accent underline underline-offset-2">Точный алгоритм</Link>
            </p>
            <table className="mt-5 w-full text-sm">
              <thead><tr className="meta text-left"><th className="pb-2 font-normal">Сигнатура</th><th className="pb-2 font-normal">Доля</th><th className="pb-2 text-right font-normal">Просмотры</th></tr></thead>
              <tbody>
                {an.canvasFingerprints.map((f) => (
                  <tr key={f.signature} className="border-t border-border">
                    <td className="py-2 font-mono text-[13px]">{f.signature}…</td>
                    <td className="py-2 text-muted-foreground">{f.pct}%</td>
                    <td className="py-2 text-right">{f.views.toLocaleString('ru-RU')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </Reveal>
      )}

      {/* Видео-плейлист: per-video демо-метрики. Retention/CTR есть только у native
          (своя телеметрия); внешние площадки без их API ничего не отдают — не выдумываем. */}
      {(() => {
        const playlist = normalizeVideos(article)
        if (playlist.length === 0) return null
        const nativeItems = playlist.filter((v) => v.source === 'native' && v.analyticsCapabilities.retention)
        // по-видео метрики — модель только у демо-статей; у настоящих их ещё не собираем — не выдумываем
        if (!demo) return null
        const perVideo = playlist.map((v) => {
          const seed = videoSeed(v.id)
          return {
            item: v,
            retentionPct: 34 + (seed % 45),
            completionPct: 22 + ((seed >> 4) % 40),
            ctrPct: 2 + ((seed >> 8) % 9),
          }
        })
        const avgRetention = nativeItems.length
          ? Math.round(perVideo.filter((p) => p.item.source === 'native').reduce((a, p) => a + p.retentionPct, 0) / nativeItems.length)
          : null
        return (
          <Reveal className="mt-10">
            <section className="rule pt-8" aria-label="Аналитика видео">
              <h2 className="font-mono text-[13px] font-bold uppercase tracking-[0.12em]">Видео · демо-ранкер</h2>
              <p className="mt-3 max-w-[62ch] text-sm leading-relaxed text-muted-foreground">
                {nativeItems.length > 0
                  ? `Сводка агрегирует только своё видео (${nativeItems.length} из ${playlist.length}): внешние площадки не отдают retention без своего API.`
                  : 'Свои видео в записи отсутствуют — агрегировать нечего.'}
              </p>
              {avgRetention !== null && (
                <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <div className="border border-border bg-secondary/40 p-4">
                    <p className="text-xl font-extrabold tracking-tight">{avgRetention}%</p>
                    <p className="meta mt-1.5">Средний retention · только native</p>
                  </div>
                </div>
              )}
              <ul className="mt-5 space-y-3">
                {perVideo.map((p, i) => (
                  <li key={p.item.id} className="border border-border bg-background p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-semibold">
                        Видео {i + 1} · {p.item.title}
                      </p>
                      <span className="meta rounded-full border border-border px-2 py-0.5">{p.item.source}</span>
                    </div>
                    {p.item.source === 'native' && p.item.analyticsCapabilities.retention ? (
                      <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1">
                        <span className="meta">retention: {p.retentionPct}%</span>
                        <span className="meta">completion: {p.completionPct}%</span>
                        <span className="meta">CTR: {p.ctrPct}%</span>
                      </div>
                    ) : (
                      <p className="meta mt-3 !normal-case tracking-normal text-muted-foreground">
                        метрики недоступны без API площадки {p.item.source}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          </Reveal>
        )
      })()}

      {/* Прозрачность / анти-накрутка */}
      <Reveal className="mt-10">
        <section
          className={`border-2 p-6 ${an.status === 'review' ? 'border-accent/60 bg-secondary/70' : 'border-border'}`}
          aria-label="Сигналы прозрачности"
        >
          <div className="flex flex-wrap items-center gap-3">
            {an.status === 'review' ? (
              <ShieldAlert size={17} className="text-accent" aria-hidden="true" />
            ) : (
              <ShieldCheck size={17} className="text-accent" aria-hidden="true" />
            )}
            <h2 className="text-lg font-extrabold tracking-tight">
              {an.status === 'review' ? 'Стоит проверить' : 'Подозрений нет'}
            </h2>
            <span className="meta">эвристика, не вердикт</span>
          </div>
          <ul className="mt-4 space-y-2.5">
            {an.signals.map((s) => (
              <li key={s.label} className="flex items-start gap-2 text-sm leading-relaxed">
                {s.ok ? (
                  <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-accent" aria-hidden="true" />
                ) : (
                  <ShieldAlert size={14} className="mt-0.5 shrink-0 text-destructive" aria-hidden="true" />
                )}
                <span className={s.ok ? '' : 'font-medium'}>{s.label}</span>
              </li>
            ))}
          </ul>
          <p className="mt-5 max-w-[66ch] text-sm leading-relaxed text-muted-foreground">
            Методика: всплеск просмотров без соразмерных комментариев и дочитываний, высокая доля анонимных
            просмотров и концентрация одного источника — повод для проверки, а не автоматический вердикт.
            Подтверждение накрутки выносит коллегия присяжных в открытом разбирательстве. {an.real
              ? 'Данные — дневные агрегаты: без рекламных cookie и хранения IP; уникальные зрители считаются по дневному хешу, а графические окружения группируются по открытой canvas-сигнатуре. Повторный просмотр в течение 30 минут не засчитывается, боты и браузеры с Do Not Track не учитываются.'
              : 'Пока реальных просмотров нет, числа демонстрационные и детерминированно выведены из записи.'}
          </p>
        </section>
      </Reveal>

      {user?.handle === article.author.handle && (
        <Reveal className="mt-10 border border-border p-6">
          <PollAnalytics article={article} />
        </Reveal>
      )}
    </div>
  )
}
