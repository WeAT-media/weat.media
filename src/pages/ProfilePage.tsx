import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router'
import { ArrowLeft, AtSign, BadgeCheck, Bell, BellRing, Bookmark, Check, Copy, Crown, Flag, Rss, UserPlus, UserCheck, X } from 'lucide-react'
import { useStore } from '@/lib/store'
import { profileMetaSeed } from '@/data/profiles'
import { languageName } from '@/data/languages'
import Stamp from '@/components/Stamp'
import Reveal from '@/components/Reveal'
import ReportDialog from '@/components/ReportDialog'
import RssButton from '@/components/RssButton'
import { buildAuthorFeed } from '@/lib/rss'
import { api, countryLabel, type ApiUser } from '@/lib/api'
import type { Author } from '@/types/types'
import { PDS_URL } from '@/config/site'

function slugify(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, '-')
}

/** Публичный профиль автора: идентичность ATProto (демо), публикации и подборки */
export default function ProfilePage() {
  const { id = '' } = useParams()
  const { articles, collections, cases, caseStats, user, following, toggleFollow, authorSubscriptions, toggleAuthorSubscription, bookmarks, toggleBookmark } = useStore()
  const [tab, setTab] = useState<'posts' | 'collections' | 'cases' | 'bookmarks'>('posts')
  const [copied, setCopied] = useState(false)
  const [remoteProfile, setRemoteProfile] = useState<ApiUser | null>(null)

  const decoded = decodeURIComponent(id)

  const author = useMemo<Author | undefined>(() => {
    const byArticle = articles.find(
      (a) =>
        a.author.handle === decoded ||
        a.author.did === decoded ||
        slugify(a.author.name) === decoded,
    )?.author
    if (byArticle) return byArticle
    if (user && (user.handle === decoded || user.did === decoded || slugify(user.name) === decoded)) {
      return { name: user.name, handle: user.handle, did: user.did }
    }
    return undefined
  }, [articles, user, decoded])

  const authorHandle = author?.handle
  useEffect(() => {
    if (!authorHandle) return
    let cancelled = false
    api.user(authorHandle).then(
      (p) => !cancelled && setRemoteProfile(p),
      () => !cancelled && setRemoteProfile(null),
    )
    return () => {
      cancelled = true
    }
  }, [authorHandle])

  if (!author) {
    return (
      <div className="mx-auto max-w-[720px] px-5 py-24 text-center">
        <p className="meta">404 · профиль не найден</p>
        <h1 className="mt-4 text-3xl font-extrabold tracking-tight">Такого автора нет</h1>
        <p className="mt-3 text-muted-foreground">
          Ищите по handle (alina-v.bsky.social), DID или имени. Возможно, автор перенёс репозиторий на другой PDS.
        </p>
        <Link to="/feed" className="btn-ghost mt-8">
          <ArrowLeft size={14} aria-hidden="true" /> К ленте
        </Link>
      </div>
    )
  }

  const meta = profileMetaSeed.find((m) => m.handle === author.handle)
  const isSelf = user?.handle === author.handle
  const remote = remoteProfile?.handle === author.handle ? remoteProfile : null
  const isPremiumUser = remote ? remote.tier === 'premium' : isSelf ? !!user?.premium : !!meta?.premium
  const joinedAt = remote?.createdAt ?? (isSelf ? user?.createdAt : undefined) ?? meta?.joinedAt
  const signupCountry = remote?.signupCountry ?? (isSelf ? user?.signupCountry : undefined)
  const isFollowed = following.includes(author.handle)
  const isSubscribedToArticles = authorSubscriptions.includes(author.handle)
  const followers = (meta?.followers ?? 0) + (isFollowed ? 1 : 0)

  const posts = articles.filter((a) => a.author.handle === author.handle)
  const cols = collections.filter((c) => c.authorHandle === author.handle)
  // дела, связанные со статьями автора; роль присяжного в данных не смоделирована
  const authorCases = cases.filter((c) => posts.some((p) => p.id === c.articleId))
  const bookmarkedArticles = articles.filter((a) => bookmarks.includes(a.id))

  const copyDid = async () => {
    try {
      await navigator.clipboard.writeText(author.did)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* буфер недоступен — did остаётся на экране */
    }
  }

  return (
    <div className="mx-auto max-w-[900px] px-5 pb-24 md:px-8">
      <div className="pt-10">
        <Link
          to="/feed"
          className="inline-flex items-center gap-2 font-mono text-[12px] font-semibold uppercase tracking-[0.08em] text-muted-foreground transition-colors hover:text-accent"
        >
          <ArrowLeft size={13} aria-hidden="true" /> Лента
        </Link>
      </div>

      {/* Карточка профиля */}
      <Reveal className="mt-8 border border-border bg-secondary/40 p-6 md:p-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-4">
            <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-primary font-mono text-xl font-bold text-primary-foreground" aria-hidden="true">
              {author.name.slice(0, 1)}
            </span>
            <div className="min-w-0">
              <h1 className="flex flex-wrap items-center gap-2 text-2xl font-extrabold tracking-tight md:text-3xl">
                {author.name}
                {isPremiumUser && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-accent/60 px-2.5 py-0.5 font-mono text-[11px] font-semibold uppercase tracking-[0.06em] text-accent">
                    <Crown size={11} aria-hidden="true" /> Premium
                  </span>
                )}
                {meta?.isCrawler && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-0.5 font-mono text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
                    <Rss size={11} aria-hidden="true" /> Краулер
                  </span>
                )}
              </h1>
              <p className="meta mt-1.5 inline-flex items-center gap-1.5">
                <AtSign size={12} aria-hidden="true" /> {author.handle}
              </p>
            </div>
          </div>
          {user && !isSelf && (
            <>
              <button
                onClick={() => toggleFollow(author.handle)}
                aria-pressed={isFollowed}
                className={isFollowed ? 'btn-ghost !border-accent !text-accent' : 'btn-primary'}
              >
                {isFollowed ? <UserCheck size={14} aria-hidden="true" /> : <UserPlus size={14} aria-hidden="true" />}
                {isFollowed ? 'Вы подписаны' : 'Подписаться'}
              </button>
              <button
                onClick={() => toggleAuthorSubscription(author.handle)}
                aria-pressed={isSubscribedToArticles}
                title="Уведомления о новых статьях автора"
                className={`btn-ghost !px-3.5 !py-2 ${isSubscribedToArticles ? '!border-accent !text-accent' : ''}`}
              >
                {isSubscribedToArticles ? <BellRing size={13} aria-hidden="true" /> : <Bell size={13} aria-hidden="true" />}
                {isSubscribedToArticles ? 'Статьи приходят' : 'Подписаться на статьи'}
              </button>
            </>
          )}
          {!user && !isSelf && (
            <Link to="/login" className="btn-ghost !px-3.5 !py-2" title="Войдите, чтобы подписаться на статьи автора">
              <Bell size={13} aria-hidden="true" /> Подписаться на статьи
            </Link>
          )}
          {!isSelf && (
            <ReportDialog
              targetType="user"
              targetId={author.handle}
              targetLabel={`${author.name} (@${author.handle})`}
              trigger={
                <button className="btn-ghost !px-3.5 !py-2 !text-[11px] hover:!border-destructive hover:!text-destructive">
                  <Flag size={12} aria-hidden="true" /> Пожаловаться
                </button>
              }
            />
          )}
        </div>

        {meta?.bio && <p className="mt-5 max-w-[64ch] text-[15px] leading-relaxed">{meta.bio}</p>}

        <dl className="mt-6 space-y-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <dt className="meta w-28 shrink-0">DID</dt>
            <dd className="flex min-w-0 items-center gap-2">
              <code className="break-all font-mono text-[12px]">{author.did}</code>
              <button
                onClick={copyDid}
                aria-label="Скопировать DID"
                title="Скопировать DID"
                className="flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-full border border-border transition-colors hover:border-accent hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {copied ? <Check size={12} className="text-accent" aria-hidden="true" /> : <Copy size={12} aria-hidden="true" />}
              </button>
            </dd>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <dt className="meta w-28 shrink-0">PDS</dt>
            <dd className="meta inline-flex items-center gap-1.5">
              <BadgeCheck size={12} className="text-accent" aria-hidden="true" />
              {remote ? new URL(PDS_URL).host : 'внешний PDS'}
            </dd>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <dt className="meta w-28 shrink-0">С нами с</dt>
            <dd className="meta">
              {joinedAt
                ? new Date(joinedAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
                : '—'}
            </dd>
          </div>
          {signupCountry && (
            <div className="flex flex-wrap items-center gap-2">
              <dt className="meta w-28 shrink-0">Страна регистрации</dt>
              <dd className="meta" title="Определена по IP при регистрации">
                {countryLabel(signupCountry)}
              </dd>
              {isSelf && (
                <Link
                  to="/support/contact?category=country-change"
                  className="meta text-accent underline-offset-4 transition-colors hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  Запросить изменение
                </Link>
              )}
            </div>
          )}
        </dl>

        {/* Статистика */}
        <div className="mt-6 grid grid-cols-2 gap-3 border-t border-border pt-6 sm:grid-cols-5">
          {[
            { label: 'Публикаций', value: posts.length },
            { label: 'Подборок', value: cols.length },
            { label: 'Подписчиков', value: followers },
            { label: 'Подписок', value: (meta?.following ?? 0) + (isSelf ? following.length : 0) },
            // приходит с сервера; у демо-авторов без аккаунта не показываем
            ...(remote?.paidSubscribers !== undefined ? [{ label: 'Платных подписчиков', value: remote.paidSubscribers }] : []),
          ].map((s) => (
            <div key={s.label}>
              <p className="text-2xl font-extrabold tracking-tight">{s.value.toLocaleString('ru-RU')}</p>
              <p className="meta mt-0.5">{s.label}</p>
            </div>
          ))}
        </div>

        <div className="mt-5 border-t border-border pt-5">
          <RssButton
            filename={`indie-${author.handle}.xml`}
            buildXml={() => buildAuthorFeed(author.name, author.handle, posts, window.location.origin)}
            label="RSS статей"
            // настоящий аккаунт площадки — постоянная лента; демо-автор — скачать
            href={remote ? `/rss/author/${author.handle}` : undefined}
          />
        </div>
      </Reveal>

      {/* Настройки — вынесены на подстраницы */}
      {isSelf && (
        <p className="mt-8">
          <Link
            to={`/profile/${user?.handle ?? ''}/settings/feed`}
            className="inline-flex items-center gap-1.5 font-mono text-[12px] font-semibold uppercase tracking-[0.08em] text-accent underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Настройки профиля, ленты и выплат →
          </Link>
        </p>
      )}

      {/* Вкладки */}
      <div
        role="tablist"
        aria-label="Разделы профиля"
        className="mt-10 inline-flex rounded-full border border-border bg-secondary/60 p-1"
      >
        {(
          [
            { key: 'posts', label: `Публикации · ${posts.length}` },
            { key: 'collections', label: `Подборки · ${cols.length}` },
            { key: 'cases', label: `Судебные разбирательства · ${authorCases.length}` },
            // закладки — приватный список, только в своём профиле
            ...(isSelf ? [{ key: 'bookmarks' as const, label: `Закладки · ${bookmarkedArticles.length}` }] : []),
          ] as { key: 'posts' | 'collections' | 'cases' | 'bookmarks'; label: string }[]
        ).map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className={`cursor-pointer rounded-full px-4 py-1.5 font-mono text-[12px] font-semibold uppercase tracking-[0.05em] transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
              tab === t.key ? 'bg-primary text-primary-foreground' : 'text-foreground hover:text-accent'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'posts' ? (
        <section aria-label="Публикации автора" className="mt-6">
          {posts.length === 0 ? (
            <p className="rule py-10 text-muted-foreground">
              Публикаций пока нет{isSelf ? ' — ваша первая запись ждёт на странице «Написать»' : ''}.
            </p>
          ) : (
            posts.map((a) => (
              <Reveal key={a.id}>
                <article className="rule py-6 first:border-t-0 first:pt-2">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                    <span className="meta">{a.publishedAt}</span>
                    <span className="meta rounded-full border border-border px-2 py-0.5">{languageName(a.language)}</span>
                    <Stamp verdict={a.verdict} small />
                  </div>
                  <h2 className="mt-2.5 text-xl font-extrabold leading-snug tracking-tight">
                    <Link
                      to={`/article/${a.id}`}
                      className="decoration-accent decoration-2 underline-offset-4 transition-colors hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {a.title}
                    </Link>
                  </h2>
                  <p className="meta mt-2">
                    {a.readingTime} мин · {a.comments.length} коммент.
                    {a.tags.length > 0 && (
                      <>
                        {' · '}
                        {a.tags.map((t) => `#${t}`).join(' ')}
                      </>
                    )}
                  </p>
                </article>
              </Reveal>
            ))
          )}
        </section>
      ) : tab === 'collections' ? (
        <section aria-label="Подборки автора" className="mt-6">
          {cols.length === 0 ? (
            <p className="rule py-10 text-muted-foreground">Подборок пока нет.</p>
          ) : (
            cols.map((c) => {
              const count = c.articleIds.filter((aid) => articles.some((a) => a.id === aid)).length
              return (
                <Reveal key={c.id}>
                  <Link
                    to={`/collection/${c.id}`}
                    className="group rule flex items-center justify-between gap-4 py-6 first:border-t-0"
                  >
                    <div>
                      <h2 className="text-lg font-extrabold tracking-tight decoration-accent underline-offset-4 group-hover:underline">
                        {c.title}
                      </h2>
                      <p className="mt-1 max-w-[60ch] text-sm leading-relaxed text-muted-foreground">{c.description}</p>
                      <p className="meta mt-2">{count} записей</p>
                    </div>
                    <span className="meta shrink-0 text-accent">открыть →</span>
                  </Link>
                </Reveal>
              )
            })
          )}
        </section>
      ) : tab === 'cases' ? (
        <section aria-label="Судебные разбирательства автора" className="mt-6">
          {authorCases.length === 0 ? (
            <p className="rule py-10 text-muted-foreground">
              Разбирательств нет: ни одна запись автора не передавалась коллегии присяжных.
            </p>
          ) : (
            authorCases.map((c) => {
              const s = caseStats(c)
              return (
                <Reveal key={c.id}>
                  <Link
                    to={`/case/${c.id}`}
                    className="group rule block py-6 first:border-t-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                      <span className="meta text-accent">{c.number}</span>
                      <span className="meta rounded-full border border-border px-2 py-0.5">Автор статьи</span>
                      {s.closed ? (
                        <Stamp verdict={s.outcome === 'guilty' ? 'guilty' : 'acquitted'} small />
                      ) : (
                        <span className="meta">принимает голоса</span>
                      )}
                    </div>
                    <h2 className="mt-2 text-lg font-extrabold leading-snug tracking-tight decoration-accent underline-offset-4 group-hover:underline">
                      {c.articleTitle}
                    </h2>
                    <p className="meta mt-2">
                      Голосов {s.voted}/{c.jurorsTotal} · кворум {c.quorum}
                      {s.closed && s.outcome && ` · вердикт: ${s.outcome === 'guilty' ? 'виновна' : 'невиновна'}`}
                    </p>
                    <span className="mt-2 block h-1 w-full max-w-60 overflow-hidden rounded-full bg-secondary">
                      <span
                        className="block h-full bg-accent transition-all duration-300"
                        style={{ width: `${(s.voted / c.jurorsTotal) * 100}%` }}
                      />
                    </span>
                  </Link>
                </Reveal>
              )
            })
          )}
        </section>
      ) : (
        <section aria-label="Мои закладки" className="mt-6">
          {bookmarkedArticles.length === 0 ? (
            <p className="rule py-10 text-muted-foreground">
              Закладок пока нет — сохраняйте записи значком <Bookmark size={11} className="inline" aria-hidden="true" /> в ленте или на странице статьи.
            </p>
          ) : (
            bookmarkedArticles.map((a) => (
              <Reveal key={a.id}>
                <article className="rule flex items-center justify-between gap-4 py-5 first:border-t-0">
                  <div className="min-w-0">
                    <h2 className="text-lg font-extrabold leading-snug tracking-tight">
                      <Link
                        to={`/article/${a.id}`}
                        className="decoration-accent decoration-2 underline-offset-4 transition-colors hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {a.title}
                      </Link>
                    </h2>
                    <p className="meta mt-1.5">@{a.author.handle} · {a.readingTime} мин</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => toggleBookmark(a.id)}
                    aria-label={`Убрать из закладок: ${a.title}`}
                    title="Убрать из закладок"
                    className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-full border border-border text-muted-foreground transition-colors hover:border-destructive hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <X size={14} aria-hidden="true" />
                  </button>
                </article>
              </Reveal>
            ))
          )}
        </section>
      )}
    </div>
  )
}
