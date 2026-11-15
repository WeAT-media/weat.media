import { useEffect, useState, useRef } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router'
import { ArrowLeft, Bell, BellOff, CircleHelp, Clapperboard, Copy, Eye, EyeOff, Flag, Gavel, Hourglass, Landmark, LineChart, MessageSquare, PenLine, Rss, Share2, Trash2 } from 'lucide-react'
import { useStore } from '@/lib/store'
import { labelers } from '@/data/mock'
import { languageName } from '@/data/languages'
import { renderInline } from '@/lib/inline'
import { getSessionVideo } from '@/lib/videoUploads'
import { normalizeVideos } from '@/lib/videos'
import Stamp from '@/components/Stamp'
import Reveal from '@/components/Reveal'
import VideoPlayer, { type VideoPlayerHandle } from '@/components/VideoPlayer'
import VideoDescription from '@/components/VideoDescription'
import ReportDialog from '@/components/ReportDialog'
import PaywallBadge from '@/components/PaywallBadge'
import RssButton from '@/components/RssButton'
import UpvoteButton from '@/components/UpvoteButton'
import BookmarkButton from '@/components/BookmarkButton'
import { buildCommentsFeed } from '@/lib/rss'
import { useArticleTracking } from '@/lib/tracking'
import { commentAnchor, fetchArticleBody, fetchComments, markdownToBlocks, remoteId } from '@/lib/remoteFeed'
import { hasSession, paidContent, pending as pendingApi } from '@/lib/api'
import { safeHref } from '@/lib/safeUrl'
import OwnershipClaim from '@/components/OwnershipClaim'
import BlocksEditor from '@/components/BlocksEditor'
import CollegiumIcon from '@/components/CollegiumIcon'
import ArticleToc from '@/components/ArticleToc'
import { tocFromBlocks } from '@/lib/toc'
import { normalizeAtProto } from '@/lib/atproto'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

/** Компактный BlockSuite-редактор для комментариев: markdown-сериализация, submit/cancel */
function CommentComposer({
  label,
  onSubmit,
  onCancel,
}: {
  label: string
  onSubmit: (markdown: string) => void | Promise<void>
  onCancel?: () => void
}) {
  const [md, setMd] = useState('')
  const [error, setError] = useState('')
  const [sending, setSending] = useState(false)
  return (
    <div>
      <p className="meta mb-2">{label}</p>
      <BlocksEditor compact value="" onChange={setMd} />
      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          disabled={sending}
          onClick={async () => {
            if (md.trim().length < 3) {
              setError('Слишком коротко — минимум 3 символа.')
              return
            }
            setSending(true)
            setError('')
            try {
              await onSubmit(md.trim())
            } catch (e) {
              // текст остаётся в редакторе — можно отправить ещё раз
              setError(e instanceof Error ? e.message : 'Не удалось отправить комментарий.')
            } finally {
              setSending(false)
            }
          }}
          className="btn-primary !px-4 !py-2"
        >
          {sending ? 'Отправка…' : 'Отправить'}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} className="btn-ghost !px-4 !py-2">
            Отмена
          </button>
        )}
      </div>
    </div>
  )
}
import Paywall from '@/components/Paywall'
import AdBanner from '@/components/AdBanner'
import Poll from '@/components/Poll'
import MdxBlock from '@/components/MdxBlock'
import Recommendations from '@/components/Recommendations'
import { SITE_NAME } from '@/config/site'
import Block from '@/components/ArticleBlock'
import { useLiveLabels } from '@/lib/labels'
import type { ArticleBlock, Comment, LabelAction } from '@/types/types'

// локальный демо-ролик (H.264/AAC, 45 c): внешний GCS-бакет BigBuckBunny отдаёт 403
const DEMO_VIDEO = '/demo-video.mp4'

function ActionPicker({ value, onChange }: { value: LabelAction; onChange: (a: LabelAction) => void }) {
  const options: { key: LabelAction; label: string }[] = [
    { key: 'hide', label: 'Скрывать' },
    { key: 'warn', label: 'Предупреждать' },
    { key: 'ignore', label: 'Игнорировать' },
  ]
  return (
    <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Действие для этой метки">
      {options.map((o) => (
        <button
          key={o.key}
          role="radio"
          aria-checked={value === o.key}
          onClick={() => onChange(o.key)}
          className={`cursor-pointer rounded-full border px-3.5 py-1.5 font-mono text-[12px] font-semibold uppercase tracking-[0.05em] transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
            value === o.key
              ? 'border-accent bg-accent text-accent-foreground'
              : 'border-border bg-transparent text-foreground hover:border-accent hover:text-accent'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export default function ArticlePage() {
  const { id } = useParams()
  const {
    articles, cases, collections, settings, actionForLabel, setLabelAction,
    addComment, deleteComment, extraComments, unlocked, unlock, user, reportToCourt,
    watchedArticles, toggleWatchArticle, videoProgress, syncVideoProgress, recordRead, forgetArticle,
  } = useStore()
  const navigate = useNavigate()
  const videoPlayerRef = useRef<VideoPlayerHandle>(null)
  const card = articles.find((a) => a.id === id)
  // лента приходит без текстов: тело статьи подгружаем здесь
  const [full, setFull] = useState<{ id: string; article: typeof card } | null>(null)
  const pendingUri = card?.bodyPending ? card.atUri : undefined
  useEffect(() => {
    if (!pendingUri || !card) return
    let alive = true
    fetchArticleBody(pendingUri).then((a) => alive && a && setFull({ id: card.id, article: { ...card, ...a, bodyPending: false } }), () => {})
    return () => {
      alive = false
    }
  }, [pendingUri, card])
  const loaded = full && full.id === card?.id ? full.article : card
  // закрытая часть платной статьи: сервер отдаёт её автору, купившему и подписчику тира — остальным 402.
  // Поэтому «своя статья доступна» и «купил — читаю» — одно и то же: спросили сервер и показали
  const privateId = loaded?.paywall?.privateContentId
  const [paid, setPaid] = useState<{ id: string; blocks: ArticleBlock[] } | null>(null)
  useEffect(() => {
    if (!privateId || !hasSession()) return
    let alive = true
    paidContent.get(privateId).then(
      (r) => alive && r && setPaid({ id: privateId, blocks: markdownToBlocks(r.body) }),
      () => {},
    )
    return () => {
      alive = false
    }
  }, [privateId, user?.did])
  const paidBlocks = paid && paid.id === privateId ? paid.blocks : null
  const article = loaded && paidBlocks ? { ...loaded, blocks: paidBlocks } : loaded
  const liveLabels = useLiveLabels(article?.atUri)
  // автор закрыл статью от поисковиков: <meta name="robots" content="noindex"> на время показа страницы
  const noindex = !!article?.noindex
  useEffect(() => {
    if (!noindex) return
    const tag = Object.assign(document.createElement('meta'), { name: 'robots', content: 'noindex' })
    document.head.appendChild(tag)
    return () => tag.remove()
  }, [noindex])
  const bodyLoading = !!article?.bodyPending
  // тред статьи из индекса: комментарии всех читателей, не только свои
  const [thread, setThread] = useState<{ uri: string; comments: Comment[] } | null>(null)
  const threadUri = article?.fromIndex ? article.atUri : undefined
  useEffect(() => {
    if (!threadUri) return
    let alive = true
    fetchComments(threadUri).then((c) => alive && setThread({ uri: threadUri, comments: c }))
    return () => {
      alive = false
    }
  }, [threadUri])
  // прямая ссылка на комментарий (/article/:id#c-…): тред грузится отдельно — прокручиваем, когда он пришёл
  const location = useLocation()
  // ждём и тред, и текст статьи: текст догружается выше комментариев и сдвинул бы прокрутку
  const threadReady = (!threadUri || thread?.uri === threadUri) && !bodyLoading
  useEffect(() => {
    const anchor = location.hash.slice(1)
    if (!anchor.startsWith('c-') || !threadReady) return
    const el = document.getElementById(anchor)
    if (!el) return
    // мгновенно: плавная прокрутка (scroll-behavior: smooth на html) обрывается, пока страница ещё дорисовывается
    el.scrollIntoView({ behavior: 'instant', block: 'center' })
    // подсветка на пару секунд — классом в DOM, без лишнего рендера всей страницы
    const flash = ['!border-accent', 'bg-accent/10']
    el.classList.add(...flash)
    const t = setTimeout(() => el.classList.remove(...flash), 2500)
    return () => {
      clearTimeout(t)
      el.classList.remove(...flash)
    }
  }, [location.hash, threadReady])
  const [showHidden, setShowHidden] = useState(false)
  const [previewEnded, setPreviewEnded] = useState(false)
  const [replyTarget, setReplyTarget] = useState<string | null>(null)
  const [composerKey, setComposerKey] = useState(0)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState<{ id: string; message: string } | null>(null)
  const [courtOpen, setCourtOpen] = useState(false)
  const [courtError, setCourtError] = useState('')
  const [charges, setCharges] = useState('')
  const [courtCollegium, setCourtCollegium] = useState('')
  const [courtLabel, setCourtLabel] = useState('')
  const [atMetaOpen, setAtMetaOpen] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)
  // низ текста в зоне видимости = дочитывание
  const endRef = useRef<HTMLDivElement>(null)
  useArticleTracking(article?.id, endRef)
  // история прочтений: один раз на открытие статьи (заголовок дождёмся, если тело ещё грузится)
  const historyId = article?.id
  const historyReady = !!article?.title
  useEffect(() => {
    if (historyId && historyReady && article) recordRead(article)
    // article берём на момент открытия — без пересчёта на каждое обновление карточки
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [historyId, historyReady])

  if (!article) {
    return (
      <div className="mx-auto max-w-[720px] px-5 py-24 text-center">
        <p className="meta">404 · запись не найдена</p>
        <h1 className="mt-4 text-3xl font-extrabold tracking-tight">Такой статьи нет</h1>
        <p className="mt-3 text-muted-foreground">Возможно, автор перенёс репозиторий на другой PDS.</p>
        <Link to="/feed" className="btn-ghost mt-8">
          <ArrowLeft size={14} aria-hidden="true" /> К ленте
        </Link>
      </div>
    )
  }

  // метки коллегий из сети (services/labeler): самая строгая по настройкам читателя становится вердиктом статьи
  const strength = (v: string) => ({ hide: 3, warn: 2, ignore: 1 })[actionForLabel(v) ?? 'ignore'] ?? 0
  const liveLabel = [...(liveLabels ?? [])].sort((x, y) => strength(y.val) - strength(x.val))[0]
  const art = liveLabel ? { ...article, verdict: 'guilty' as const, verdictLabel: liveLabel.val } : article
  const caseFile = article.caseId ? cases.find((c) => c.id === article.caseId) : undefined
  const labelMeta = art.verdictLabel
    ? labelers.flatMap((l) => l.labels.map((x) => ({ ...x, labelerId: l.id, labelerName: l.name }))).find((x) => x.value === art.verdictLabel)
    : undefined
  const labelerId = labelMeta?.labelerId ?? ''
  const subscribed = settings[labelerId]?.subscribed ?? false
  const action = actionForLabel(art.verdictLabel ?? '') ?? 'warn'
  const bodyHidden = art.verdict === 'guilty' && subscribed && action === 'hide' && !showHidden
  // доступ: сервер отдал закрытую часть (автор, купивший) или демо-статья открыта локально
  const isUnlocked = !article.paywall || !!paidBlocks || !!unlocked[article.id]
  // без покупки: тизер вместо тела; если тизер не задан — как раньше, первые два блока
  const visibleBlocks = isUnlocked ? article.blocks : article.teaser ? [] : article.blocks.slice(0, 2)
  // номер опроса среди всех опросов статьи (visibleBlocks — префикс article.blocks)
  const pollIndexOf = (i: number) => article.blocks.slice(0, i).filter((b) => b.type === 'poll').length
  // TOC строится по видимым блокам (paywall-усечение учитывается), ids стабильны
  const tocItems = tocFromBlocks(visibleBlocks)
  // мок: зритель находится в РФ — GEO-ограничение применяется
  const geoBlocked = (article.geoBlock?.regions ?? []).includes('RU')
  const collection = article.collectionId
    ? collections.find((c) => c.id === article.collectionId)
    : undefined
  // локальный файл доступен как object URL только в сессии загрузки; иначе — ссылка или демо-источник
  const videoSrc =
    getSessionVideo(article.id) ??
    (article.videoUrl && !article.videoUrl.startsWith('demo://') ? article.videoUrl : DEMO_VIDEO)
  // плейлист: videos[] или legacy одиночное видео; demo://-источники показывают демо-ролик
  const playlist = normalizeVideos(article, videoSrc).map((v) =>
    v.source === 'native' && (!v.src || v.src.startsWith('demo://')) ? { ...v, src: DEMO_VIDEO } : v,
  )
  // аналитика видео: у записи из индекса — её id в индексе (по нему ранжирование находит статью), иначе — локальный
  const videoTrackId = article.fromIndex && article.atUri ? remoteId(article.atUri) : article.id
  // импорт краулера: handle crawler-<id>.<домен>
  const canTransfer = !!article.source && (article.sourceType === 'crawler' || article.author.handle.startsWith('crawler-'))
  const isOwnArticle = !!user && user.handle === article.author.handle
  const atMeta = normalizeAtProto(article)

  const copyMeta = async (key: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(key)
      window.setTimeout(() => setCopied(null), 1500)
    } catch {
      /* clipboard может быть недоступен — просто не показываем подтверждение */
    }
  }

  const courtCollegiumDef = labelers.find((l) => l.id === courtCollegium)
  const courtReady = !!courtCollegiumDef && !!courtLabel && charges.trim().length >= 5

  const onReport = () => {
    if (!courtReady) return
    try {
      const caseId = reportToCourt(article.id, { collegiumId: courtCollegium, labelValue: courtLabel, charges: charges.trim() })
      navigate(`/case/${caseId}`)
    } catch (e) {
      setCourtError(e instanceof Error ? e.message : 'Не удалось подать дело.')
    }
  }

  // свой только что отправленный комментарий уже есть в треде индекса — не дублируем
  const threadComments = thread && thread.uri === article.atUri ? thread.comments : []
  const threadIds = new Set(threadComments.map((c) => c.id))
  const allComments = [
    ...(extraComments[article.id] ?? []).filter((c) => !threadIds.has(c.id)),
    ...threadComments,
    ...article.comments,
  ]
  const commentIds = new Set(allComments.map((c) => c.id))
  const rootComments = allComments.filter((c) => !c.parentId || !commentIds.has(c.parentId))
  const repliesByParent = new Map<string, typeof allComments>()
  for (const c of allComments) {
    if (c.parentId && commentIds.has(c.parentId)) {
      const arr = repliesByParent.get(c.parentId) ?? []
      arr.push(c)
      repliesByParent.set(c.parentId, arr)
    }
  }
  for (const arr of repliesByParent.values()) arr.sort((x, y) => x.at.localeCompare(y.at))
  const watching = watchedArticles.includes(article.id)

  const MAX_COMMENT_DEPTH = 3

  // свой: запись в моём репозитории (at://<мой did>/…) или отправленный только что локально
  const isMine = (c: Comment) =>
    !!user && (c.id.startsWith('at://') ? c.id.split('/')[2] === user.did : (extraComments[article.id] ?? []).some((x) => x.id === c.id))
  const removeComment = async (c: Comment) => {
    setDeleteError(null)
    try {
      await deleteComment(article.id, c.id)
      setThread((t) => (t ? { ...t, comments: t.comments.filter((x) => x.id !== c.id) } : t))
      setConfirmDelete(null)
    } catch (e) {
      setDeleteError({ id: c.id, message: e instanceof Error ? e.message : 'Не удалось удалить комментарий.' })
    }
  }

  const renderComment = (c: (typeof allComments)[number], depth: number) => {
    const replies = repliesByParent.get(c.id) ?? []
    const indent = Math.min(depth, MAX_COMMENT_DEPTH)
    return (
      <li
        key={c.id}
        id={commentAnchor(c.id)}
        className={`scroll-mt-28 border-l-2 border-border pl-4 transition-colors duration-700 ${indent > 0 ? 'ml-5' : ''}`}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="meta">
            @{c.author} · {c.at}
            {c.pendingUntil && new Date(c.pendingUntil) > new Date() && (
              <span title="Период охлаждения: пока только на weAT.media, удаление не оставит следа в сети"> · в сеть — {new Date(c.pendingUntil).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
            )}
            {depth > 0 && ' · ответ'}
          </p>
          <div className="flex items-center gap-3">
            <UpvoteButton commentId={c.id} />
            <button
              onClick={() => setReplyTarget(replyTarget === c.id ? null : c.id)}
              className="inline-flex cursor-pointer items-center gap-1 font-mono text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground transition-colors hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Ответить
            </button>
            {isMine(c) &&
              (confirmDelete === c.id ? (
                <span className="inline-flex items-center gap-2 font-mono text-[11px] font-semibold uppercase tracking-[0.06em]">
                  <button
                    onClick={() => removeComment(c)}
                    className="cursor-pointer text-destructive hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    Удалить навсегда
                  </button>
                  <button
                    onClick={() => setConfirmDelete(null)}
                    className="cursor-pointer text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    Отмена
                  </button>
                </span>
              ) : (
                <button
                  onClick={() => setConfirmDelete(c.id)}
                  className="inline-flex cursor-pointer items-center gap-1 font-mono text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground transition-colors hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <Trash2 size={10} aria-hidden="true" /> Удалить
                </button>
              ))}
            <ReportDialog
              targetType="comment"
              targetId={c.id}
              targetLabel={c.text.slice(0, 80)}
              trigger={
                <button className="inline-flex cursor-pointer items-center gap-1 font-mono text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground transition-colors hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <Flag size={10} aria-hidden="true" /> Пожаловаться
                </button>
              }
            />
          </div>
        </div>
        <p className="mt-1.5 whitespace-pre-line text-[15px] leading-relaxed">{renderInline(c.text)}</p>
        {deleteError?.id === c.id && <p className="mt-1 text-sm text-destructive">{deleteError.message}</p>}
        {replies.length > 0 && depth >= MAX_COMMENT_DEPTH && (
          <p className="meta mt-1">ответов: {replies.length} — дальше ветка показана плоско</p>
        )}
        {replyTarget === c.id && (
          <div className="mt-3">
            <CommentComposer
              key={c.id}
              label={`Ваш ответ @${c.author} · markdown`}
              onSubmit={async (md) => {
                await addComment(article.id, md, c.id)
                setReplyTarget(null)
              }}
              onCancel={() => setReplyTarget(null)}
            />
          </div>
        )}
        {replies.length > 0 && (
          <ul className="mt-4 space-y-5">
            {replies.map((r) => renderComment(r, depth + 1))}
          </ul>
        )}
      </li>
    )
  }

  return (
    <div className="mx-auto max-w-[1200px] px-5 pb-24 md:px-8">
      <div className="mx-auto max-w-[44rem] pt-10">
        <Link
          to="/feed"
          className="inline-flex items-center gap-2 font-mono text-[12px] font-semibold uppercase tracking-[0.08em] text-muted-foreground transition-colors hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ArrowLeft size={13} aria-hidden="true" /> Лента
        </Link>

        <Reveal className="mt-8">
          <div className="flex flex-wrap items-center gap-3">
            <span className="meta">{article.publishedAt}</span>
            <span className="meta">{article.readingTime} мин чтения</span>
            <span className="meta rounded-full border border-border px-2 py-0.5" title="Язык публикации">
              {languageName(article.language)}
            </span>
            <Stamp verdict={art.verdict} small />
            <UpvoteButton articleId={article.id} />
            <BookmarkButton articleId={article.id} />
            <Link
              to={`/article/${article.id}/analytics`}
              className="meta inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 transition-colors hover:border-accent hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <LineChart size={11} aria-hidden="true" /> Аналитика
            </Link>
            <button
              type="button"
              onClick={() => setAtMetaOpen(true)}
              aria-label="Метаданные AT Protocol"
              title="Метаданные AT Protocol"
              className="meta inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-border px-2.5 py-1 transition-colors hover:border-accent hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <CircleHelp size={11} aria-hidden="true" /> AT
            </button>
            {atMeta.sourceType !== 'native-pds' && (
              <span className="meta rounded-full border border-dashed border-border px-2 py-0.5" title="Запись живёт не на PDS площадки">
                внешняя запись · {atMeta.sourceType}
              </span>
            )}
          </div>
          <h1 className="mt-4 text-[34px] font-extrabold leading-[1.15] tracking-tight md:text-[42px]">
            {article.title}
            <PaywallBadge hasPaywall={!!article.paywall} unlocked={isUnlocked} />
          </h1>
          {article.subtitle && <p className="mt-3 text-lg text-muted-foreground">{article.subtitle}</p>}
          {article.pendingUntil && new Date(article.pendingUntil) > new Date() && (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border border-dashed border-accent bg-secondary/40 p-4">
              <p className="meta inline-flex min-w-0 flex-wrap items-center gap-1.5 !normal-case tracking-normal">
                <Hourglass size={12} aria-hidden="true" /> Период охлаждения: в сеть AT уйдёт{' '}
                {new Date(article.pendingUntil).toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}.{' '}
                {isOwnArticle ? 'До этого правка и удаление не оставят следа в сети.' : 'Пока видна только на weAT.media.'}{' '}
                <Link to="/docs#cooldown" className="text-accent underline-offset-4 hover:underline">Подробнее</Link>
              </p>
              {isOwnArticle && article.atUri && (
                <span className="flex gap-2">
                  <Link to={`/compose?${new URLSearchParams({ pending: article.atUri })}`} className="btn-ghost !px-3 !py-1.5 !text-[11px]">
                    <PenLine size={13} aria-hidden="true" /> Редактировать
                  </Link>
                  <button
                    type="button"
                    onClick={async () => {
                      if (!window.confirm('Удалить статью? В сеть она ещё не ушла — следа не останется.')) return
                      try {
                        await pendingApi.remove(article.atUri!)
                        forgetArticle(article.atUri!)
                        navigate('/feed')
                      } catch (e) {
                        window.alert(e instanceof Error ? e.message : 'Не удалось удалить')
                      }
                    }}
                    className="btn-ghost !px-3 !py-1.5 !text-[11px] text-destructive"
                  >
                    <Trash2 size={13} aria-hidden="true" /> Удалить
                  </button>
                </span>
              )}
            </div>
          )}
          <div className="mt-6 flex items-center gap-3 border-y border-border py-4">
            <Link
              to={`/profile/${article.author.handle}`}
              aria-label={`Профиль: ${article.author.name}`}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary font-mono text-sm font-bold text-primary-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {article.author.name.slice(0, 1)}
            </Link>
            <div>
              <p className="text-sm font-semibold">
                <Link
                  to={`/profile/${article.author.handle}`}
                  className="underline-offset-4 transition-colors hover:text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {article.author.name}
                </Link>
              </p>
              <p className="meta">@{article.author.handle} · {article.author.did}</p>
            </div>
          </div>
          {!!article.reviewers?.length && (
            <p className="meta mt-3">
              Рецензенты:{' '}
              {article.reviewers.map((r, i) => (
                <span key={r.did}>
                  {i > 0 && ', '}
                  <Link to={`/profile/${r.handle ?? r.did}`} className="text-accent underline-offset-4 hover:underline">
                    @{r.handle ?? r.did.slice(0, 18)}
                  </Link>
                </span>
              ))}
            </p>
          )}
          {collection && (
            <p className="meta mt-3 inline-flex items-center gap-1.5">
              <Share2 size={11} aria-hidden="true" /> из подборки{' '}
              <Link to={`/collection/${collection.id}`} className="text-accent underline-offset-4 hover:underline">
                {collection.title}
              </Link>
            </p>
          )}
          {article.source && (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border border-dashed border-border bg-secondary/40 p-4">
              <p className="meta inline-flex min-w-0 flex-wrap items-center gap-1.5">
                <Rss size={11} aria-hidden="true" /> Импортировано с{' '}
                <a href={safeHref(article.source.url)} target="_blank" rel="noreferrer" className="text-accent underline-offset-4 hover:underline">
                  {article.source.label}
                </a>{' '}
                · краулер @{article.author.handle}
              </p>
              {canTransfer && <OwnershipClaim article={article} />}
            </div>
          )}
        </Reveal>

        {/* Метаданные AT Protocol */}
        <Dialog open={atMetaOpen} onOpenChange={setAtMetaOpen}>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>Метаданные AT Protocol</DialogTitle>
              <DialogDescription>
                Запись принадлежит автору и живёт в его репозитории; площадка лишь индексирует её.
              </DialogDescription>
            </DialogHeader>
            <dl className="space-y-4 text-sm">
              {(
                [
                  { k: 'atUri', label: 'AT URI', hint: 'адрес записи: did автора / коллекция / rkey', value: atMeta.atUri, copy: true },
                  { k: 'cid', label: 'CID', hint: 'контент-хэш версии записи', value: atMeta.cid, copy: false },
                  { k: 'originPds', label: 'Origin PDS', hint: 'персональный сервер, где хранится оригинал', value: atMeta.originPds, copy: false },
                  { k: 'indexedAt', label: 'Indexed at', hint: 'когда AppView площадки увидел запись', value: atMeta.indexedAt, copy: false },
                  { k: 'sourceType', label: 'Тип источника', hint: 'native-pds — свой PDS · external-pds — внешний · crawler — импорт · repost — репост', value: atMeta.sourceType, copy: false },
                  { k: 'canonicalId', label: 'Canonical ID', hint: 'канонический идентификатор публикации (при репосте — оригинал)', value: atMeta.canonicalId, copy: true },
                ] as const
              ).map((row) => (
                <div key={row.k} className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <dt className="meta inline-flex items-center gap-1.5">
                      {row.label}
                    </dt>
                    <dd className="mt-1 break-all font-mono text-[12px] leading-relaxed">{row.value}</dd>
                    <dd className="mt-1 text-[12px] text-muted-foreground">{row.hint}</dd>
                  </div>
                  {row.copy && (
                    <button
                      type="button"
                      onClick={() => copyMeta(row.k, row.value)}
                      aria-label={`Скопировать ${row.label}`}
                      className="mt-1 flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-full border border-border transition-colors hover:border-accent hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <Copy size={12} aria-hidden="true" />
                    </button>
                  )}
                </div>
              ))}
            </dl>
            {copied && <p className="meta text-accent">Скопировано: {copied}</p>}
            {atMeta.notInRepo && (
              <p className="border border-dashed border-accent bg-secondary/50 p-3 text-[12px] leading-relaxed text-muted-foreground">
                Этой статьи нет в вашем AT-репозитории: она сохранена только в этом браузере и другим не видна.
                Откройте её в редакторе и опубликуйте снова.
              </p>
            )}
            <p className="border border-dashed border-border bg-secondary/50 p-3 text-[12px] leading-relaxed text-muted-foreground">
              Аналитика на странице записи — это метрики {SITE_NAME}, а не всей ATmosphere: другие AppView
              считают своё.
            </p>
          </DialogContent>
        </Dialog>

        {/* GEO-ограничение по решению суда */}
        {geoBlocked && article.geoBlock && (
          <Reveal className="mt-8 border-2 border-primary bg-secondary/70 p-6">
            <p className="meta inline-flex items-center gap-1.5">
              <Landmark size={12} aria-hidden="true" /> Доступ ограничен в вашем регионе (РФ)
            </p>
            <p className="mt-2 text-[15px] leading-relaxed">{article.geoBlock.reason}.</p>
            <p className="meta mt-3">{article.geoBlock.courtRef}</p>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              Ограничение действует только в указанной юрисдикции: запись остаётся в репозитории автора и
              доступна из остальных регионов. Протокольно — метка <code className="rounded bg-background px-1">geo.restricted</code>.
            </p>
          </Reveal>
        )}

        {/* Панель вердикта / разбирательства */}
        {art.verdict === 'guilty' && labelMeta && (
          <Reveal className="mt-8 border-2 border-accent/60 bg-secondary/70 p-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="meta text-accent">{labelMeta.value}</p>
                <p className="mt-2 text-[15px] leading-relaxed">
                  Коллегия «{labelMeta.labelerName}» признала статью нарушающей: {labelMeta.description.toLowerCase()}.
                  Статья не удалена — она принадлежит автору. Решаете вы.
                </p>
              </div>
              <Stamp verdict="guilty" />
            </div>
            {subscribed ? (
              <div className="mt-5">
                <p className="meta mb-2.5">Ваше действие для этой метки</p>
                <ActionPicker
                  value={action}
                  onChange={(a) => setLabelAction(labelerId, labelMeta.value, a)}
                />
              </div>
            ) : (
              <p className="mt-5 text-sm text-muted-foreground">
                Вы не подписаны на эту коллегию — метка для вас ни на что не влияет.{' '}
                <Link to="/settings" className="font-semibold text-accent underline-offset-4 hover:underline">
                  Настроить подписки
                </Link>
              </p>
            )}
          </Reveal>
        )}

        {art.verdict === 'trial' && caseFile && (
          <Reveal className="mt-8 border-2 border-dashed border-border bg-secondary/50 p-6">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <p className="meta">{caseFile.number} · идёт разбирательство</p>
                <p className="mt-2 text-[15px] leading-relaxed">
                  Статья оспорена читателями. Коллегия из {caseFile.jurorsTotal} случайных присяжных рассматривает
                  дело — вердикт будет выдан подписанной меткой, а не удалением.
                </p>
              </div>
              <Stamp verdict="trial" />
            </div>
            <Link to={`/case/${caseFile.id}`} className="btn-ghost mt-5 !px-4 !py-2">
              <Gavel size={14} aria-hidden="true" /> Следить за делом
            </Link>
          </Reveal>
        )}

        {art.verdict === 'acquitted' && caseFile && (
          <Reveal className="mt-8 flex flex-wrap items-center justify-between gap-4 border border-border bg-secondary/50 p-6">
            <p className="max-w-[52ch] text-[15px] leading-relaxed text-muted-foreground">
              <span className="meta block text-foreground">{caseFile.number}</span>
              Коллегия рассмотрела жалобу и оправдала статью. Метка не выдана; вердикт можно пересмотреть только
              через апелляцию с новой коллегией.
            </p>
            <Stamp verdict="acquitted" />
          </Reveal>
        )}

        {/* Тело статьи */}
        <Reveal className="mt-10">
          {geoBlocked ? (
            <div className="border border-dashed border-border p-10 text-center">
              <p className="meta">Материал недоступен в вашем регионе</p>
              <p className="mx-auto mt-3 max-w-[46ch] text-sm text-muted-foreground">
                Ограничение введено по реквизитам суда и действует только в РФ. Из других юрисдикций запись
                открывается в полном объёме — данные принадлежат автору, а не площадке.
              </p>
            </div>
          ) : bodyHidden ? (
            <div className="border border-dashed border-border p-10 text-center">
              <p className="meta">Скрыто по вашим настройкам модерации</p>
              <p className="mx-auto mt-3 max-w-[46ch] text-sm text-muted-foreground">
                Метка «{labelMeta?.value}» настроена на скрытие. Статья остаётся в репозитории автора — вы просто
                не видите её по умолчанию.
              </p>
              <button onClick={() => setShowHidden(true)} className="btn-ghost mt-6 !px-4 !py-2">
                <Eye size={14} aria-hidden="true" /> Показать всё равно
              </button>
            </div>
          ) : (
            <div className="relative">
              {bodyHidden === false && art.verdict === 'guilty' && subscribed && action === 'hide' && showHidden && (
                <button
                  onClick={() => setShowHidden(false)}
                  className="btn-ghost mb-6 !px-4 !py-2"
                >
                  <EyeOff size={14} aria-hidden="true" /> Снова скрыть
                </button>
              )}
              {playlist.length > 0 && (
                <div className="space-y-10">
                  {/* навигация по плейлисту — только когда видео несколько */}
                  {playlist.length > 1 && (
                    <nav aria-label="Видео в этой записи" className="flex flex-wrap gap-2">
                      {playlist.map((v, i) => (
                        <a
                          key={v.id}
                          href={`#video-${i + 1}`}
                          className="meta inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 transition-colors hover:border-accent hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          <Clapperboard size={11} aria-hidden="true" /> Видео {i + 1}
                        </a>
                      ))}
                    </nav>
                  )}
                  {playlist.map((v, i) => {
                    const lockedExternal = !isUnlocked && v.source !== 'native'
                    const lockedNative = !isUnlocked && v.source === 'native' && !article.videoPreviewRange
                    const previewNative = !isUnlocked && v.source === 'native' && !!article.videoPreviewRange
                    return (
                      <section key={v.id} id={`video-${i + 1}`} className="scroll-mt-28" aria-label={`Видео ${i + 1}: ${v.title}`}>
                        {playlist.length > 1 && (
                          <p className="meta mb-2">Видео {i + 1} из {playlist.length}</p>
                        )}
                        <div className="mb-3 flex flex-wrap items-center gap-2">
                          {playlist.length > 1 && <h2 className="text-lg font-bold tracking-tight">{v.title}</h2>}
                          <span className="meta rounded-full border border-border px-2 py-0.5">
                            {v.source === 'native' ? 'своё видео' : v.source}
                          </span>
                        </div>
                        {lockedExternal ? (
                          <div className="my-4 flex aspect-video w-full flex-col items-center justify-center gap-3 rounded-md bg-primary text-primary-foreground/70">
                            <Clapperboard size={28} aria-hidden="true" />
                            <p className="meta !text-primary-foreground/60">
                              Видео с {v.source} откроется после покупки
                            </p>
                          </div>
                        ) : v.source === 'native' ? (
                          previewNative ? (
                            <>
                              <VideoPlayer
                                ref={videoPlayerRef}
                                src={v.src ?? videoSrc}
                                title={v.title}
                                previewRange={article.videoPreviewRange}
                                onPreviewEnd={() => setPreviewEnded(true)}
                                trackId={videoTrackId}
                              />
                              <p className="meta -mt-5 mb-2 inline-flex items-center gap-1.5 text-accent">
                                <Eye size={11} aria-hidden="true" /> Бесплатное превью: {article.videoPreviewRange!.start}–
                                {article.videoPreviewRange!.end} сек · полная версия — после покупки
                              </p>
                              {previewEnded && (
                                <p className="mb-8 text-sm text-muted-foreground">
                                  Превью закончилось — полное видео откроется после оформления доступа ниже.
                                </p>
                              )}
                            </>
                          ) : lockedNative ? (
                            <div className="my-4 flex aspect-video w-full flex-col items-center justify-center gap-3 rounded-md bg-primary text-primary-foreground/70">
                              <Clapperboard size={28} aria-hidden="true" />
                              <p className="meta !text-primary-foreground/60">Полное видео доступно после покупки</p>
                            </div>
                          ) : (
                            <VideoPlayer
                              ref={videoPlayerRef}
                              src={v.src ?? videoSrc}
                              title={v.title}
                              trackId={videoTrackId}
                              resumeKey={`${videoTrackId}:${v.id}`}
                              resumeRemote={videoProgress[`${videoTrackId}:${v.id}`]}
                              onSyncProgress={(t, d) => syncVideoProgress(`${videoTrackId}:${v.id}`, t, d)}
                            />
                          )
                        ) : (
                          <div className="my-4 aspect-video w-full overflow-hidden rounded-md border border-border bg-primary/95">
                            {v.videoId ? (
                              <iframe
                                src={
                                  v.source === 'youtube'
                                    ? `https://www.youtube-nocookie.com/embed/${v.videoId}`
                                    : `https://www.loom.com/embed/${v.videoId}`
                                }
                                title={v.title}
                                loading="lazy"
                                allowFullScreen
                                referrerPolicy="strict-origin-when-cross-origin"
                                sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"
                                className="h-full w-full"
                              />
                            ) : (
                              <div className="flex h-full w-full flex-col items-center justify-center gap-3 text-primary-foreground/70">
                                <Clapperboard size={28} aria-hidden="true" />
                                <p className="meta !text-primary-foreground/60">Loom preview demo — публичного ID нет, iframe не встроен</p>
                              </div>
                            )}
                          </div>
                        )}
                        {/* описание и кликабельные таймкоды — у своего плеера */}
                        {v.source === 'native' && v.description && (isUnlocked || previewNative) && (
                          <VideoDescription
                            text={v.description}
                            onSeek={(seconds) => videoPlayerRef.current?.seekTo(seconds)}
                          />
                        )}
                        {v.source !== 'native' && v.description && !lockedExternal && (
                          <p className="mb-8 mt-2 whitespace-pre-line text-sm leading-relaxed text-muted-foreground">{v.description}</p>
                        )}
                        {v.source === 'native' && article.videoSource === 'file' && !getSessionVideo(article.id) && (
                          <p className="meta -mt-5 mb-8 inline-flex items-center gap-1.5">
                            Локальный файл{article.videoFileName ? ` «${article.videoFileName}»` : ''} был доступен только
                            в сессии загрузки — показан демо-источник
                          </p>
                        )}
                      </section>
                    )
                  })}
                </div>
              )}
              {article.teaser && (
                <p className="my-8 max-w-[68ch] border-l-2 border-accent pl-5 text-[17px] leading-relaxed">
                  {article.teaser}
                </p>
              )}
              {/* TOC: mobile details над текстом; desktop sticky- aside справа, не меняя ширину колонки */}
              {tocItems.length > 0 && (
                <>
                  <div className="mb-6 xl:hidden">
                    <ArticleToc items={tocItems} observeRootId="article-blocks" />
                  </div>
                  <aside className="absolute right-[-248px] top-0 hidden h-full w-[220px] 2xl:block">
                    <div className="sticky top-24 max-h-[calc(100vh-8rem)] overflow-y-auto">
                      <ArticleToc items={tocItems} observeRootId="article-blocks" />
                    </div>
                  </aside>
                </>
              )}
              <div id="article-blocks">
              {bodyLoading && (
                <div className="mt-6 space-y-3" role="status" aria-label="Загружаем текст статьи">
                  {[92, 100, 84, 96, 70].map((w, i) => (
                    <div key={i} className="h-4 animate-pulse rounded bg-secondary" style={{ width: `${w}%` }} />
                  ))}
                </div>
              )}
              {/* у каждого опроса свои голоса: номер среди опросов статьи */}
              {visibleBlocks.map((b, i) => (
                <div key={i}>
                  {b.type === 'poll' ? (
                    <Poll article={article} raw={b.text} index={pollIndexOf(i)} />
                  ) : b.type === 'mdx' ? (
                    <MdxBlock component={b.component ?? 'box'} text={b.text} />
                  ) : (
                    <Block block={b} id={tocItems.find((t) => t.index === i)?.id} />
                  )}
                  {i === 2 && <AdBanner articleUri={article.atUri} />}
                </div>
              ))}
              </div>
              {visibleBlocks.length < 3 && <AdBanner articleUri={article.atUri} />}
              {article.paywall && (
                <Paywall
                  article={article}
                  unlocked={isUnlocked}
                  onUnlock={() => unlock(article.id)}
                />
              )}
              {article.paywall && !isUnlocked && (
                <p className="meta mt-2">Комментарии открыты всем — аргументы не продаются.</p>
              )}

              {/* Вынести на суд */}
              <div className="rule mt-10 pt-6">
                {isOwnArticle ? (
                  <p className="meta inline-flex items-center gap-1.5 text-muted-foreground">
                    <Gavel size={13} aria-hidden="true" /> Это ваша статья — свою статью нельзя вынести на суд.
                    Пожаловаться на комментарии или других пользователей по-прежнему можно.
                  </p>
                ) : courtOpen ? (
                  <div>
                    <fieldset>
                      <legend className="meta">1. Коллегия — какой вид нарушения?</legend>
                      <div className="mt-3 grid gap-2 sm:grid-cols-2">
                        {labelers.map((l) => {
                          const on = courtCollegium === l.id
                          return (
                            <label
                              key={l.id}
                              className={`cursor-pointer rounded-md border p-3 transition-colors ${on ? 'border-accent bg-accent/10' : 'border-border hover:border-accent'}`}
                            >
                              <input
                                type="radio"
                                name="court-collegium"
                                value={l.id}
                                checked={on}
                                onChange={() => {
                                  setCourtCollegium(l.id)
                                  setCourtLabel(l.labels.length === 1 ? l.labels[0]!.value : '')
                                }}
                                className="sr-only"
                              />
                              <span className="flex items-center gap-2.5 text-sm font-semibold">
                                <CollegiumIcon id={l.id} size={14} />
                                {l.name}
                              </span>
                              <span className="mt-1 block text-[13px] leading-snug text-muted-foreground">{l.description}</span>
                              <span className="meta mt-1.5 block !normal-case tracking-normal">
                                подписчиков: {l.subscribers.toLocaleString('ru-RU')}
                              </span>
                            </label>
                          )
                        })}
                      </div>
                    </fieldset>

                    {courtCollegiumDef && (
                      <fieldset className="mt-5">
                        <legend className="meta">2. Нарушение</legend>
                        <div className="mt-2 space-y-1.5">
                          {courtCollegiumDef.labels.map((lbl) => (
                            <label key={lbl.value} className="flex w-full cursor-pointer items-start justify-start gap-2.5 text-left text-[15px]">
                              <input
                                type="radio"
                                name="court-label"
                                value={lbl.value}
                                checked={courtLabel === lbl.value}
                                onChange={() => setCourtLabel(lbl.value)}
                                className="mt-1 shrink-0 accent-[hsl(var(--accent))]"
                                style={{ width: 16, height: 16, flex: '0 0 16px', margin: '4px 0 0' }}
                              />
                              <span className="min-w-0 flex-1">
                                {lbl.description}
                                <span className="meta ml-2 !normal-case tracking-normal">{lbl.value}</span>
                              </span>
                            </label>
                          ))}
                        </div>
                      </fieldset>
                    )}

                    {courtLabel && (
                      <>
                        <label htmlFor="charges" className="meta mt-5 block">3. Суть претензии — что именно и где нарушено?</label>
                        <textarea
                          id="charges"
                          value={charges}
                          onChange={(e) => setCharges(e.target.value)}
                          rows={3}
                          className="mt-2 w-full resize-y rounded-md border border-input bg-background px-4 py-3 text-[15px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          placeholder="Например: в разделе «Бенчмарки» цифры не воспроизводятся, методика не указана"
                        />
                      </>
                    )}
                    <div className="mt-3 flex flex-wrap gap-3">
                      <button onClick={onReport} disabled={!courtReady} className="btn-primary !px-4 !py-2">
                        <Gavel size={14} aria-hidden="true" />{' '}
                        {courtCollegiumDef ? `Подать в «${courtCollegiumDef.name}»` : 'Подать в суд присяжных'}
                      </button>
                      <button onClick={() => setCourtOpen(false)} className="btn-ghost !px-4 !py-2">Отмена</button>
                    </div>
                    {courtError && <p className="mt-3 text-sm text-destructive">{courtError}</p>}
                  </div>
                ) : (
                  <button onClick={() => setCourtOpen(true)} className="btn-ghost !px-4 !py-2">
                    <Gavel size={14} aria-hidden="true" /> Вынести статью на суд
                  </button>
                )}
              </div>

              <div ref={endRef} aria-hidden="true" />
              <Recommendations excludeId={article.id} />
            </div>
          )}
        </Reveal>

        {/* Комментарии */}
        <Reveal className="mt-16">
          <div className="rule pt-8">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <MessageSquare size={15} className="text-accent" aria-hidden="true" />
                <h2 className="font-mono text-[13px] font-bold uppercase tracking-[0.12em]">
                  Комментарии · {allComments.length}
                </h2>
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => toggleWatchArticle(article.id)}
                  aria-pressed={watching}
                  title={watching ? 'Перестать следить за ответами' : 'Следить за ответами'}
                  className={`inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1.5 font-mono text-[11px] font-semibold uppercase tracking-[0.06em] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                    watching ? 'border-accent text-accent' : 'border-border text-muted-foreground hover:border-accent hover:text-accent'
                  }`}
                >
                  {watching ? <BellOff size={12} aria-hidden="true" /> : <Bell size={12} aria-hidden="true" />}
                  {watching ? 'Вы следите' : 'Следить за комментариями'}
                </button>
                <RssButton
                  filename={`indie-comments-${article.id}.xml`}
                  buildXml={() => buildCommentsFeed(article, allComments, window.location.origin)}
                  label="RSS"
                  href={article.fromIndex && article.atUri ? `/rss/comments/${article.atUri.split('/')[2]}/${article.atUri.split('/')[4]}` : undefined}
                />
              </div>
            </div>
            <ul className="mt-6 space-y-6">
              {rootComments.map((c) => renderComment(c, 0))}
            </ul>
            <div className="mt-8">
              <CommentComposer
                key={composerKey}
                label="Ваш комментарий"
                onSubmit={async (md) => {
                  await addComment(article.id, md)
                  setComposerKey((k) => k + 1)
                }}
              />
              <p className="meta mt-3 !normal-case tracking-normal">
                после отправки вы следите за ответами в этой записи — отключается переключателем «Следить за
                комментариями» выше
              </p>
            </div>
          </div>
        </Reveal>
      </div>
    </div>
  )
}
