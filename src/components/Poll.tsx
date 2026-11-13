import { useEffect, useMemo, useState } from 'react'
import { BarChart3, CheckCircle2, EyeOff, ListChecks, Lock, MapPin, RotateCcw, Shuffle, Square, Timer, Users } from 'lucide-react'
import { Link } from 'react-router'
import { useStore } from '@/lib/store'
import { api, countryLabel } from '@/lib/api'
import { durationLabel, parsePoll, pollKey, readVote, shuffledOrder, tallyPoll, voteKey } from '@/lib/poll'
import type { Article } from '@/types/types'

function timeLeft(ms: number): string {
  const m = Math.ceil(ms / 60_000)
  if (m < 60) return `${m} мин`
  const h = Math.floor(m / 60)
  if (h < 24) return m % 60 ? `${h} ч ${m % 60} мин` : `${h} ч`
  return h % 24 ? `${Math.floor(h / 24)} дн ${h % 24} ч` : `${h / 24} дн`
}

/** index — порядковый номер опроса в статье: у каждого опроса свои голоса */
export default function Poll({ article, raw, index = 0 }: { article: Article; raw: string; index?: number }) {
  const {
    user, pollVotes, pollClosed, castPollVote, retractPollVote, closePoll, isPremium, unlocked, following, authorSubscriptions,
  } = useStore()
  const poll = useMemo(() => parsePoll(raw), [raw])
  const { settings } = poll
  const key = pollKey(article.id, index)
  const [selected, setSelected] = useState<number[]>([])
  const [now, setNow] = useState(() => Date.now())
  const [geoCountry, setGeoCountry] = useState<string | null>(null)

  const myVote = readVote(pollVotes, article.id, index, user?.handle)
  const voted = myVote !== undefined
  const isAuthor = !!user && user.handle === article.author.handle

  const order = useMemo(
    () => (settings.shuffle ? shuffledOrder(poll.options.length, `${key}:${user?.did ?? 'guest'}`) : poll.options.map((_, i) => i)),
    [settings.shuffle, poll.options, key, user?.did],
  )

  // срок считается от публикации; автор может закрыть опрос раньше
  const endsAt = useMemo(() => {
    if (!settings.durationHours) return null
    const start = new Date(poll.startsAt ?? article.publishAt ?? `${article.publishedAt}T00:00:00`).getTime()
    return Number.isNaN(start) ? null : start + settings.durationHours * 3_600_000
  }, [settings.durationHours, poll.startsAt, article.publishAt, article.publishedAt])
  const stoppedAt = pollClosed[key]
  const expired = endsAt !== null && now >= endsAt
  const closed = expired || !!stoppedAt

  useEffect(() => {
    if (endsAt === null || closed) return
    const t = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => window.clearInterval(t)
  }, [endsAt, closed])

  const country = user?.signupCountry ?? geoCountry
  useEffect(() => {
    if (settings.countries.length === 0 || user?.signupCountry) return
    let cancelled = false
    api.geo().then((g) => !cancelled && setGeoCountry(g.country), () => {})
    return () => {
      cancelled = true
    }
  }, [settings.countries.length, user?.signupCountry])

  const isSubscriber =
    following.includes(article.author.handle) || authorSubscriptions.includes(article.author.handle) || !!unlocked[article.id]

  const reasons: string[] = []
  if (settings.authorizedOnly && !user) reasons.push('голосуют только вошедшие пользователи')
  if (settings.subscribersOnly && !isSubscriber) reasons.push('голосуют только подписчики автора')
  if (settings.countries.length > 0 && !(country && settings.countries.includes(country))) {
    reasons.push(`голосование только для: ${settings.countries.map((c) => countryLabel(c)).join(', ')}`)
  }
  if (poll.minPremiumMonths > 0 && !(isPremium && (user?.premiumSinceMonths ?? 0) >= poll.minPremiumMonths)) {
    reasons.push(`только Premium со стажем от ${poll.minPremiumMonths} мес.`)
  }
  const blocked = reasons.length > 0
  const canVote = !voted && !blocked && !closed
  const canRetract = voted && settings.allowRetract && !closed

  // результаты: после своего голоса или только после завершения; автору — всегда (он видит аналитику)
  const resultsVisible = closed || isAuthor || (settings.showResults === 'afterVote' && voted)
  // участники: никогда в анонимном; иначе сразу или после завершения
  const votersVisible = !settings.anonymous && (settings.showVoters === 'always' || closed)

  const tally = tallyPoll(pollVotes, key, poll.options.length)
  const pctOf = (i: number) => {
    const denom = settings.multiple ? tally.participants : tally.totalVotes
    return denom === 0 ? 0 : Math.round((tally.counts[i]! / denom) * 100)
  }

  const toggle = (i: number) => {
    if (!canVote) return
    setSelected((prev) => (settings.multiple ? (prev.includes(i) ? prev.filter((x) => x !== i) : [...prev, i]) : [i]))
  }

  const vote = () => {
    if (!canVote || selected.length === 0) return
    castPollVote(voteKey(key, user?.handle), [...selected].sort((a, b) => a - b))
  }

  const retract = () => {
    if (!canRetract) return
    setSelected(myVote ?? [])
    retractPollVote(voteKey(key, user?.handle))
  }

  return (
    <section aria-label="Опрос" className="my-8 border border-border bg-secondary/50 p-6">
      <p className="meta flex flex-wrap items-center gap-x-4 gap-y-1">
        <span className="inline-flex items-center gap-1.5 text-accent">
          <BarChart3 size={12} aria-hidden="true" /> Опрос
        </span>
        <span className="inline-flex items-center gap-1">
          {settings.anonymous ? <EyeOff size={11} aria-hidden="true" /> : <Users size={11} aria-hidden="true" />}
          {settings.anonymous ? 'анонимный' : settings.showVoters === 'always' ? 'открытый' : 'участники после завершения'}
        </span>
        {settings.multiple && (
          <span className="inline-flex items-center gap-1">
            <ListChecks size={11} aria-hidden="true" /> несколько ответов
          </span>
        )}
        {settings.shuffle && (
          <span className="inline-flex items-center gap-1">
            <Shuffle size={11} aria-hidden="true" /> варианты перемешаны
          </span>
        )}
        {(settings.durationHours || stoppedAt) && (
          <span className="inline-flex items-center gap-1">
            <Timer size={11} aria-hidden="true" />
            {stoppedAt
              ? 'автор остановил приём ответов'
              : closed
                ? 'завершён'
                : endsAt
                  ? `осталось ${timeLeft(endsAt - now)}`
                  : durationLabel(settings.durationHours!)}
          </span>
        )}
        {settings.countries.length > 0 && (
          <span className="inline-flex items-center gap-1">
            <MapPin size={11} aria-hidden="true" /> {settings.countries.join(', ')}
          </span>
        )}
        {(settings.subscribersOnly || poll.minPremiumMonths > 0) && (
          <span className="inline-flex items-center gap-1">
            <Users size={11} aria-hidden="true" /> подписчики
          </span>
        )}
        {settings.authorizedOnly && (
          <span className="inline-flex items-center gap-1">
            <Lock size={11} aria-hidden="true" /> вошедшие
          </span>
        )}
      </p>

      <h3 className="mt-3 text-lg font-extrabold tracking-tight">{poll.question}</h3>

      <div className="mt-4 space-y-2" role={settings.multiple ? 'group' : 'radiogroup'} aria-label={poll.question}>
        {order.map((i) => {
          const opt = poll.options[i]!
          const mine = myVote?.includes(i) ?? false
          const picked = selected.includes(i)
          const pct = pctOf(i)
          const optVoters = tally.voters[i] ?? []
          return (
            <div key={i}>
              <button
                type="button"
                role={settings.multiple ? 'checkbox' : 'radio'}
                aria-checked={mine || picked}
                disabled={!canVote}
                onClick={() => toggle(i)}
                className={`relative block w-full cursor-pointer overflow-hidden rounded-md border px-4 py-2.5 text-left text-[15px] transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default ${
                  mine || picked ? 'border-accent' : 'border-border enabled:hover:border-accent'
                }`}
              >
                {resultsVisible && (
                  <span className="absolute inset-y-0 left-0 bg-accent/15 transition-all duration-300" style={{ width: `${pct}%` }} aria-hidden="true" />
                )}
                <span className="relative flex items-center justify-between gap-3">
                  <span className="inline-flex items-center gap-2">
                    {canVote && (
                      <span
                        aria-hidden="true"
                        className={`flex h-4 w-4 shrink-0 items-center justify-center border ${settings.multiple ? 'rounded-sm' : 'rounded-full'} ${picked ? 'border-accent bg-accent' : 'border-border'}`}
                      >
                        {picked && <span className={`block bg-accent-foreground ${settings.multiple ? 'h-2 w-2 rounded-[1px]' : 'h-1.5 w-1.5 rounded-full'}`} />}
                      </span>
                    )}
                    {mine && <CheckCircle2 size={15} className="text-accent" aria-hidden="true" />}
                    {opt}
                  </span>
                  {resultsVisible && <span className="meta">{pct}% · {tally.counts[i]}</span>}
                </span>
              </button>
              {votersVisible && resultsVisible && optVoters.length > 0 && (
                <p className="meta mt-1 truncate pl-1 !normal-case tracking-normal" title={optVoters.join(', ')}>
                  {optVoters.slice(0, 4).map((h) => `@${h}`).join(', ')}
                  {tally.counts[i]! > 4 && ` и ещё ${tally.counts[i]! - 4}`}
                </p>
              )}
            </div>
          )
        })}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
        {canVote ? (
          <>
            <button type="button" onClick={vote} disabled={selected.length === 0} className="btn-primary !px-4 !py-2">
              Проголосовать
            </button>
            <p className="meta">
              {selected.length === 0
                ? settings.multiple
                  ? 'выберите один или несколько вариантов'
                  : 'выберите вариант'
                : settings.multiple
                  ? `выбрано: ${selected.length}`
                  : ''}
            </p>
          </>
        ) : voted ? (
          <>
            <p className="meta">
              Ваш голос учтён
              {resultsVisible ? ` · проголосовало: ${tally.participants}` : ' · результаты откроются после завершения'}
            </p>
            {canRetract && (
              <button type="button" onClick={retract} className="btn-ghost !px-3 !py-1.5 !text-[11px]">
                <RotateCcw size={12} aria-hidden="true" /> Отозвать голос
              </button>
            )}
          </>
        ) : closed ? (
          <p className="meta">Голосование завершено · проголосовало: {tally.participants}</p>
        ) : (
          <p className="text-sm text-muted-foreground">
            Недоступно: {reasons.join('; ')}.
            {settings.authorizedOnly && !user && (
              <>
                {' '}
                <Link to="/login" className="text-accent underline-offset-4 hover:underline">Войти</Link>
              </>
            )}
          </p>
        )}
      </div>

      {isAuthor && (
        <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-border pt-4">
          <span className="meta">вы автор</span>
          {!closed && (
            <button type="button" onClick={() => closePoll(key)} className="btn-ghost !px-3 !py-1.5 !text-[11px] hover:!border-destructive hover:!text-destructive">
              <Square size={11} aria-hidden="true" /> Остановить приём ответов
            </button>
          )}
          <Link to={`/article/${article.id}/analytics#polls`} className="meta underline-offset-4 hover:text-accent hover:underline">
            аналитика опроса →
          </Link>
        </div>
      )}
    </section>
  )
}
