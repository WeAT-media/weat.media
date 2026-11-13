import { BarChart3, EyeOff, Square, Users } from 'lucide-react'
import { useStore } from '@/lib/store'
import { parsePoll, pollKey, tallyPoll } from '@/lib/poll'
import type { Article } from '@/types/types'

/** Аналитика всех опросов статьи — только автору. В анонимных участники скрыты и от автора. */
export default function PollAnalytics({ article }: { article: Article }) {
  const { pollVotes, pollClosed, closePoll } = useStore()
  const polls = article.blocks.filter((b) => b.type === 'poll').map((b) => parsePoll(b.text))
  if (polls.length === 0) return null

  return (
    <section id="polls" aria-label="Опросы" className="scroll-mt-24">
      <h2 className="inline-flex items-center gap-2 font-mono text-[13px] font-bold uppercase tracking-[0.12em]">
        <BarChart3 size={14} aria-hidden="true" /> Опросы · {polls.length}
      </h2>
      <p className="meta mt-1 !normal-case tracking-normal">видно только вам как автору</p>

      <div className="mt-5 space-y-6">
        {polls.map((poll, idx) => {
          const key = pollKey(article.id, idx)
          const t = tallyPoll(pollVotes, key, poll.options.length)
          const stopped = pollClosed[key]
          const max = Math.max(...t.counts, 1)
          return (
            <article key={key} className="border border-border p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-[15px] font-semibold">{poll.question}</p>
                  <p className="meta mt-1 inline-flex flex-wrap items-center gap-x-3 gap-y-1 !normal-case tracking-normal">
                    <span className="inline-flex items-center gap-1">
                      {poll.settings.anonymous ? <EyeOff size={11} aria-hidden="true" /> : <Users size={11} aria-hidden="true" />}
                      {poll.settings.anonymous ? 'анонимный' : 'открытый'}
                    </span>
                    <span>проголосовало: {t.participants}</span>
                    <span>голосов: {t.totalVotes}</span>
                    {stopped && <span>приём остановлен {new Date(stopped).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' })}</span>}
                  </p>
                </div>
                {!stopped && (
                  <button type="button" onClick={() => closePoll(key)} className="btn-ghost !px-3 !py-1.5 !text-[11px] hover:!border-destructive hover:!text-destructive">
                    <Square size={11} aria-hidden="true" /> Остановить приём ответов
                  </button>
                )}
              </div>

              <ul className="mt-4 space-y-3">
                {poll.options.map((opt, i) => (
                  <li key={i}>
                    <div className="flex items-baseline justify-between gap-3 text-sm">
                      <span>{opt}</span>
                      <span className="meta">{t.counts[i]} · {t.totalVotes ? Math.round((t.counts[i]! / t.totalVotes) * 100) : 0}%</span>
                    </div>
                    <div className="mt-1 h-2 rounded-full bg-secondary" aria-hidden="true">
                      <div className="h-2 rounded-full bg-accent" style={{ width: `${(t.counts[i]! / max) * 100}%` }} />
                    </div>
                    {poll.settings.anonymous ? null : (
                      <p className="meta mt-1.5 !normal-case tracking-normal">
                        {(t.voters[i] ?? []).map((h) => `@${h}`).join(', ')}
                        {t.counts[i]! > (t.voters[i]?.length ?? 0) && ` и ещё ${t.counts[i]! - (t.voters[i]?.length ?? 0)}`}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
              {poll.settings.anonymous && (
                <p className="mt-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground">
                  <EyeOff size={13} aria-hidden="true" /> Опрос анонимный: кто как голосовал, не видит никто, включая вас.
                </p>
              )}
            </article>
          )
        })}
      </div>
    </section>
  )
}
