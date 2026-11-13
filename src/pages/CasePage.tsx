import { Link, useParams } from 'react-router'
import { ArrowLeft, ArrowUpRight, Gavel, Scale, ShieldCheck } from 'lucide-react'
import { useStore } from '@/lib/store'
import { labelers } from '@/data/mock'
import CollegiumIcon from '@/components/CollegiumIcon'
import { buildCaseFeed } from '@/lib/rss'
import Stamp from '@/components/Stamp'
import Reveal from '@/components/Reveal'
import RssButton from '@/components/RssButton'
import type { VoteValue } from '@/types/types'

export default function CasePage() {
  const { id } = useParams()
  const { cases, caseStats, votes, castVote, juryOptOut, user, articles } = useStore()
  const caseFile = cases.find((c) => c.id === id)

  if (!caseFile) {
    return (
      <div className="mx-auto max-w-[720px] px-5 py-24 text-center">
        <p className="meta">404 · дело не найдено</p>
        <h1 className="mt-4 text-3xl font-extrabold tracking-tight">Такого дела нет в реестре</h1>
        <Link to="/feed" className="btn-ghost mt-8">
          <ArrowLeft size={14} aria-hidden="true" /> К ленте
        </Link>
      </div>
    )
  }

  const s = caseStats(caseFile)
  const myVote = votes[caseFile.id]
  const guiltyPct = s.voted === 0 ? 0 : (s.guilty / s.voted) * 100

  const doVote = (v: VoteValue) => castVote(caseFile.id, v)

  return (
    <div className="pb-24">
      {/* Тёмная «судебная» шапка */}
      <section className="bg-primary text-primary-foreground">
        <div className="mx-auto max-w-[1200px] px-5 py-14 md:px-8">
          <Link
            to="/cases"
            className="inline-flex items-center gap-2 font-mono text-[12px] font-semibold uppercase tracking-[0.08em] text-primary-foreground/70 transition-colors hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ArrowLeft size={13} aria-hidden="true" /> Реестр дел
          </Link>
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <Gavel size={20} className="text-accent" aria-hidden="true" />
            <h1 className="font-mono text-xl font-bold tracking-[0.14em] md:text-2xl">{caseFile.number}</h1>
            <span className="meta !text-primary-foreground/60">
              открыто {caseFile.openedAt} · {s.closed ? 'закрыто' : 'принимает голоса'}
            </span>
            <Link
              to={`/case/${caseFile.id}/analytics`}
              className="meta inline-flex items-center gap-1.5 rounded-full border border-primary-foreground/30 px-2.5 py-1 transition-colors hover:border-accent hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Scale size={11} aria-hidden="true" /> Аналитика
            </Link>
            <RssButton
              filename={`indie-case-${caseFile.id}.xml`}
              buildXml={() =>
                buildCaseFeed(
                  caseFile,
                  articles.find((a) => a.id === caseFile.articleId),
                  caseStats(caseFile),
                  window.location.origin,
                )
              }
              label="RSS"
            />
          </div>
          {(() => {
            // коллегия дела: явная или по метке (у старых дел только labelValue)
            const col =
              labelers.find((l) => l.id === caseFile.collegiumId) ??
              labelers.find((l) => l.labels.some((x) => x.value === caseFile.labelValue))
            const lbl = col?.labels.find((x) => x.value === caseFile.labelValue)
            return col ? (
              <p className="meta mt-6 flex items-center gap-2.5 !normal-case tracking-normal text-primary-foreground/70">
                <CollegiumIcon id={col.id} size={13} />
                {col.name}
                {lbl && ` · ${lbl.description}`}
              </p>
            ) : null
          })()}
          <p className="mt-3 max-w-[62ch] text-lg leading-relaxed text-primary-foreground/85">
            {caseFile.charges}
          </p>
          <Link
            to={`/article/${caseFile.articleId}`}
            className="group mt-6 inline-flex max-w-full items-start gap-2 border-b border-accent pb-1 text-[15px] font-semibold text-primary-foreground transition-colors hover:text-accent"
          >
            <span className="min-w-0 break-words">Предмет разбирательства: {caseFile.articleTitle}</span>
            <ArrowUpRight size={15} className="mt-1 shrink-0 transition-transform duration-200 group-hover:-translate-y-0.5 group-hover:translate-x-0.5" aria-hidden="true" />
          </Link>
        </div>
      </section>

      <div className="mx-auto grid max-w-[1200px] gap-12 px-5 pt-12 md:px-8 lg:grid-cols-[minmax(0,1fr)_360px]">
        {/* Коллегия присяжных */}
        <Reveal>
          <section aria-label="Состав коллегии">
            <h2 className="font-mono text-[13px] font-bold uppercase tracking-[0.12em]">Состав коллегии</h2>
            <p className="mt-3 max-w-[62ch] text-sm leading-relaxed text-muted-foreground">
              Семь присяжных выбраны случайно из пула читателей с репутацией 1000+. Имена скрыты до конца
              голосования — метка выходит подписанной коллегией, а не отдельными людьми.
            </p>

            <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
              {Array.from({ length: caseFile.jurorsTotal }, (_, i) => {
                const voted = i < s.voted
                return (
                  <div
                    key={i}
                    className={`flex flex-col items-center gap-2 border px-2 py-4 text-center ${
                      voted ? 'border-accent/70 bg-secondary/70' : 'border-dashed border-border'
                    }`}
                  >
                    <span
                      className={`flex h-9 w-9 items-center justify-center rounded-full font-mono text-[12px] font-bold ${
                        voted ? 'bg-accent text-accent-foreground' : 'bg-secondary text-muted-foreground'
                      }`}
                    >
                      {voted ? '✓' : '·'}
                    </span>
                    <span className="meta">Присяжный №{i + 1}</span>
                  </div>
                )
              })}
            </div>

            {/* Ход голосования */}
            <div className="rule mt-10 pt-8">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="font-mono text-[13px] font-bold uppercase tracking-[0.12em]">Ход голосования</h2>
                <span className="meta">
                  {s.voted}/{caseFile.jurorsTotal} · кворум {caseFile.quorum}
                </span>
              </div>
              <div className="mt-5 h-2.5 overflow-hidden rounded-full bg-secondary" role="progressbar" aria-valuenow={s.voted} aria-valuemin={0} aria-valuemax={caseFile.jurorsTotal}>
                <div className="h-full bg-accent transition-all duration-300" style={{ width: `${(s.voted / caseFile.jurorsTotal) * 100}%` }} />
              </div>
              {s.voted > 0 ? (
                <div className="mt-6 flex h-3 w-full overflow-hidden rounded-sm bg-secondary" aria-label={`За виновность ${s.guilty}, за оправдание ${s.clear}`}>
                  <div className="h-full bg-accent" style={{ width: `${guiltyPct}%` }} />
                  <div className="h-full bg-primary" style={{ width: `${100 - guiltyPct}%` }} />
                </div>
              ) : (
                <div className="mt-6 h-3 w-full rounded-sm border border-dashed border-border" aria-label="Голосов пока нет" />
              )}
              <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1">
                <span className="meta">Виновна: {s.guilty}</span>
                <span className="meta">Невиновна: {s.clear}</span>
              </div>
            </div>

            {/* Вердикт / голосование */}
            {s.closed ? (
              <div className="mt-10 border-2 border-accent/60 bg-secondary/70 p-7">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <p className="meta text-accent">Вердикт вынесен</p>
                    <p className="mt-2 max-w-[54ch] text-[15px] leading-relaxed">
                      {s.outcome === 'guilty'
                        ? `Коллегия единогласно признала нарушение. Выпущена метка «${caseFile.labelValue}» — она действует только на подписчиков коллегии. Статья остаётся в репозитории автора.`
                        : 'Коллегия признала нарушение недоказанным. Метка не выдана; жалоба может быть возобновлена через апелляцию с новым составом.'}
                    </p>
                    {myVote && (
                      <p className="meta mt-3">Ваш голос: {myVote === 'guilty' ? 'виновна' : 'невиновна'}</p>
                    )}
                  </div>
                  <Stamp verdict={s.outcome === 'guilty' ? 'guilty' : 'acquitted'} />
                </div>
              </div>
            ) : (
              <div className="rule mt-10 pt-8">
                <h2 className="font-mono text-[13px] font-bold uppercase tracking-[0.12em]">Ваш голос как присяжного</h2>
                <p className="mt-3 max-w-[62ch] text-sm leading-relaxed text-muted-foreground">
                  Вас выбрали в состав этой коллегии. Голос анонимен и подписывается только ключом коллегии.
                  {myVote && ' Голос можно изменить до закрытия дела.'}
                </p>
                <div className="mt-6 flex flex-wrap gap-3">
                  <button
                    onClick={() => doVote('guilty')}
                    aria-pressed={myVote === 'guilty'}
                    disabled={juryOptOut}
                    className={`btn-primary ${myVote === 'guilty' ? '!bg-accent' : ''}`}
                  >
                    Виновна
                  </button>
                  <button
                    onClick={() => doVote('clear')}
                    aria-pressed={myVote === 'clear'}
                    disabled={juryOptOut}
                    className={`btn-ghost ${myVote === 'clear' ? '!border-accent !text-accent' : ''}`}
                  >
                    Невиновна
                  </button>
                </div>
                {juryOptOut && (
                  <p className="mt-4 max-w-[56ch] border border-dashed border-border p-4 text-sm text-muted-foreground">
                    Вы отказались от участия в коллегиях присяжных, поэтому голосование для вас закрыто.
                    Вернуть участие можно в{' '}
                    <Link to={`/profile/${user?.handle ?? 'you.judge.dev'}/settings/jury`} className="font-semibold text-accent underline-offset-4 hover:underline">
                      настройках участия в суде
                    </Link>
                    .
                  </p>
                )}
                {myVote && (
                  <p className="meta mt-4 text-accent">
                    Голос принят: «{myVote === 'guilty' ? 'виновна' : 'невиновна'}»
                  </p>
                )}
              </div>
            )}
          </section>
        </Reveal>

        {/* Лента событий дела */}
        <Reveal>
          <aside className="space-y-10">
            <section className="rule pt-6" aria-label="Хронология дела">
              <h2 className="font-mono text-[13px] font-bold uppercase tracking-[0.12em]">Хронология</h2>
              <ol className="mt-5 space-y-5">
                {[
                  { at: caseFile.openedAt, text: 'Жалоба принята, сформирована коллегия из 7 присяжных' },
                  { at: caseFile.openedAt, text: 'Материалы дела извлечены из репозитория автора (read-only)' },
                  { at: '—', text: s.closed ? 'Кворум достигнут, вердикт вынесен' : 'Ожидается кворум: голоса 5 из 7' },
                ].map((ev, i) => (
                  <li key={i} className="flex gap-4">
                    <span className="meta w-24 shrink-0 pt-0.5">{ev.at}</span>
                    <span className="relative border-l border-border pl-4 text-sm leading-relaxed">
                      <span className="absolute -left-[5px] top-2 h-2 w-2 rounded-full bg-accent" aria-hidden="true" />
                      {ev.text}
                    </span>
                  </li>
                ))}
              </ol>
            </section>

            <section className="rule pt-6">
              <div className="flex items-center gap-2">
                <ShieldCheck size={15} className="text-accent" aria-hidden="true" />
                <h2 className="font-mono text-[13px] font-bold uppercase tracking-[0.12em]">Гарантии</h2>
              </div>
              <ul className="mt-4 list-none space-y-3 text-sm leading-relaxed text-muted-foreground">
                <li>— Ни админ, ни модератор не могут удалить статью или «забанить» автора.</li>
                <li>— Вердикт — это подписанная метка; отзывается только негацией при апелляции.</li>
                <li>— Автор может перенести репозиторий на любой PDS, не теряя читателей.</li>
              </ul>
            </section>
          </aside>
        </Reveal>
      </div>
    </div>
  )
}
