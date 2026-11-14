import { FEE_NOTE } from '@/components/FeeNote'
import { markdownToBlocks } from '@/lib/remoteFeed'
import { useEffect, useMemo, useState, type DragEvent, type FormEvent, type KeyboardEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import {
  ArrowLeft,
  Lock,
  Clapperboard,
  FileText,
  Share2,
  UploadCloud,
  X,
} from 'lucide-react'
import { useStore } from '@/lib/store'
import { CURRENCIES, formatMoney, type Currency } from '@/lib/money'
import { durationLabel, parsePoll } from '@/lib/poll'
import { currentUser } from '@/data/mock'
import { profileMetaSeed } from '@/data/profiles'
import { MAX_VIDEO_SIZE, formatFileSize, keepSessionVideo, releaseObjectUrl } from '@/lib/videoUploads'
import { LANGUAGES } from '@/data/languages'
import Reveal from '@/components/Reveal'
import VideoPlayer from '@/components/VideoPlayer'
import BlocksEditor from '@/components/BlocksEditor'
import { drafts as draftsApi, hasSession, imports, shared as sharedApi, type SharedPerson } from '@/lib/api'
import PeopleAutocomplete, { type PersonCandidate } from '@/components/PeopleAutocomplete'
import ArticleToc from '@/components/ArticleToc'
import BlockView from '@/components/ArticleBlock'
import MdxBlock from '@/components/MdxBlock'
import { tocFromBlocks, tocFromMarkdown } from '@/lib/toc'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import type { Article, ArticleBlock, ArticleLanguage, Paywall } from '@/types/types'

/** Мини-разметка: ### заголовок, ``` код ```, > цитата, - список, абзацы через пустую строку */
/** предпросмотр — тем же разбором, что страница статьи (списки «* », свои блоки, экранирование BlockSuite) */
function parseBlocks(text: string): ArticleBlock[] {
  // ведущая `# Title`-строка — page-title из BlockSuite-редактора, в тело не входит
  return markdownToBlocks(text.replace(/^#\s+.*(?:\n+|$)/, ''))
}

/** Нормализация самописного тега: lowercase, пробелы в дефисы, безопасные символы, до 24 знаков */
function normalizeTag(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\p{L}\p{N}_-]/gu, '')
    .slice(0, 24)
}

const MAX_TAGS = 5


function Preview({ article }: { article: Article }) {
  const tocItems = tocFromBlocks(article.blocks)
  return (
    <div className="rounded-md border border-border bg-background p-6">
      <p className="meta">Предпросмотр</p>
      <h1 className="mt-3 text-2xl font-extrabold tracking-tight">{article.title}</h1>
      {article.subtitle && <p className="mt-2 text-muted-foreground">{article.subtitle}</p>}
      {article.paywall && (
        <p className="meta mt-3 inline-flex items-center gap-1.5 text-accent">
          <Lock size={11} aria-hidden="true" /> Платная · {formatMoney(article.paywall.price, article.paywall.currency ?? 'RUB')}
          {article.paywall.period === 'month' ? '/мес' : ' разово'}
        </p>
      )}
      {article.kind === 'video' && (
        <div className="mt-4 flex aspect-video w-full items-center justify-center rounded-md bg-primary">
          <Clapperboard size={28} className="text-primary-foreground/60" aria-hidden="true" />
        </div>
      )}
      <div className="mt-6" id="preview-blocks">
        {tocItems.length > 0 && (
          <div className="mb-5">
            <ArticleToc items={tocItems} observeRootId="preview-blocks" />
          </div>
        )}
        {article.blocks.length === 0 ? (
          <p className="text-sm text-muted-foreground">Текст пока пуст — начните писать слева.</p>
        ) : (
          // те же блоки, что на странице статьи (кнопка, FAQ, видео, картинки…); опрос — превью без голосов
          article.blocks.map((b, i) =>
            b.type === 'poll' ? (
              <PollPreview key={i} raw={b.text} />
            ) : b.type === 'mdx' ? (
              <MdxBlock key={i} component={b.component ?? 'box'} text={b.text} />
            ) : (
              <BlockView key={i} block={b} id={tocItems.find((t) => t.index === i)?.id} />
            ),
          )
        )}
      </div>
    </div>
  )
}

function PollPreview({ raw }: { raw: string }) {
  const { question, options, settings } = parsePoll(raw)
  const flags = [
    settings.multiple ? 'несколько ответов' : 'один ответ',
    settings.shuffle && 'перемешать',
    settings.subscribersOnly && 'только подписчики',
    settings.authorizedOnly && 'только вошедшие',
    settings.countries.length > 0 && settings.countries.join(', '),
    settings.durationHours && durationLabel(settings.durationHours),
    settings.anonymous ? 'анонимный' : settings.showVoters === 'always' ? 'участники видны' : 'участники после завершения',
    settings.allowRetract && 'можно отозвать',
    settings.showResults === 'afterClose' && 'результаты после завершения',
  ].filter(Boolean)
  return (
    <div className="mt-4 rounded-md border border-border bg-secondary/50 p-4">
      <p className="meta">Опрос · {flags.join(' · ')}</p>
      <p className="mt-1 text-sm font-semibold">{question}</p>
      {options.map((o, j) => (
        <p key={j} className="mt-1 text-sm">· {o}</p>
      ))}
    </div>
  )
}

export default function ComposePage() {
  const navigate = useNavigate()
  const { publishArticle, payoutConnected, user, collections, tiers, articles, prefs } = useStore()
  const [bodyText, setBodyText] = useState('')
  const [title, setTitle] = useState('')
  // ?import=<id> — черновик из импорта постов AT-аккаунта: редактор открывается с его текстом
  const [searchParams, setSearchParams] = useSearchParams()
  const importId = searchParams.get('import')
  // ?draft=<id> — свой черновик с сервера; без него первый ввод создаёт новый черновик
  const draftParam = searchParams.get('draft')
  const [draftId, setDraftId] = useState<string | null>(draftParam)
  const [draftSaved, setDraftSaved] = useState<string>('')
  const [importReady, setImportReady] = useState(!importId && !draftParam)
  useEffect(() => {
    if (!draftParam) return
    draftsApi
      .get(draftParam)
      .then((d) => {
        setTitle(d.title)
        setBodyText(d.text)
        setDraftSaved(new Date(d.updatedAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }))
      })
      .catch(() => setDraftId(null))
      .finally(() => setImportReady(true))
  }, [draftParam])
  useEffect(() => {
    if (!importId) return
    imports
      .get(importId)
      .then((d) => {
        // заголовок — и в state, и строкой `# …`: редактор берёт page-title из неё
        const t = d.title || d.text.split(/\n{2,}/)[0]?.trim() || 'Без заголовка'
        setTitle(t)
        setBodyText(`# ${t}\n\n${d.text}`)
      })
      .catch(() => {})
      .finally(() => setImportReady(true))
  }, [importId])
  // автосохранение черновика: через 2 с после правки, пока пишете; только с аккаунтом и если есть текст
  useEffect(() => {
    if (!importReady || !hasSession() || (!title.trim() && !bodyText.trim())) return
    const t = window.setTimeout(async () => {
      try {
        const body = { title: title.trim(), text: bodyText }
        const d = draftId ? await draftsApi.save(draftId, body) : await draftsApi.create(body)
        if (!draftId) {
          setDraftId(d.id)
          // ссылка на черновик — в адресе: перезагрузка и другое устройство откроют его же
          setSearchParams((p) => {
            const n = new URLSearchParams(p)
            n.set('draft', d.id)
            return n
          }, { replace: true })
        }
        setDraftSaved(new Date(d.updatedAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }))
      } catch {
        setDraftSaved('')
      }
    }, 2000)
    return () => window.clearTimeout(t)
    // draftId/setSearchParams в зависимостях перезапускали бы сохранение после создания
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, bodyText, importReady])
  const [subtitle, setSubtitle] = useState('')
  const [tags, setTags] = useState<string[]>([])
  const [tagInput, setTagInput] = useState('')
  const [language, setLanguage] = useState<ArticleLanguage>('ru')
  const [kind, setKind] = useState<'text' | 'video'>('text')
  const [hasVideoEmbed, setHasVideoEmbed] = useState(false)
  const [videoMode, setVideoMode] = useState<'link' | 'file'>('link')
  const [videoUrl, setVideoUrl] = useState('')
  const [videoDesc, setVideoDesc] = useState('')
  const [videoPreview, setVideoPreview] = useState<{ file: File; url: string } | null>(null)

  // кандидаты для @handle-автодополнения соавтора/редактора: авторы записей
  // и известные профили площадки, без текущего пользователя, без дублей
  const peopleCandidates = useMemo<PersonCandidate[]>(() => {
    const byHandle = new Map<string, PersonCandidate>()
    for (const a of articles) byHandle.set(a.author.handle, { handle: a.author.handle, name: a.author.name })
    for (const p of profileMetaSeed) {
      if (!byHandle.has(p.handle)) byHandle.set(p.handle, { handle: p.handle })
    }
    byHandle.delete(currentUser.handle)
    if (user) byHandle.delete(user.handle)
    return [...byHandle.values()].sort((a, b) => a.handle.localeCompare(b.handle))
  }, [articles, user])

  // object URL отзываем при замене/удалении файла и размонтировании;
  // URL, переданный опубликованной статье, помечен kept и не отзывается
  useEffect(() => {
    return () => {
      if (videoPreview) releaseObjectUrl(videoPreview.url)
    }
  }, [videoPreview])

  const selectVideoFile = (file: File | null) => {
    if (!file) return
    if (!file.type.startsWith('video/')) {
      setErrors((prev) => ({ ...prev, videoFile: 'Нужен видеофайл: mp4, webm, mov и т.п.' }))
      return
    }
    if (file.size > MAX_VIDEO_SIZE) {
      setErrors((prev) => ({ ...prev, videoFile: `Файл слишком большой — до ${formatFileSize(MAX_VIDEO_SIZE)}.` }))
      return
    }
    setVideoPreview({ file, url: URL.createObjectURL(file) })
    setErrors((prev) => ({ ...prev, videoFile: '' }))
  }

  const clearVideoFile = () => setVideoPreview(null)

  const onVideoDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    selectVideoFile(e.dataTransfer.files?.[0] ?? null)
  }

  const addTag = (raw: string) => {
    const t = normalizeTag(raw)
    if (!t) return
    if (tags.includes(t)) {
      setTagInput('')
      return
    }
    if (tags.length >= MAX_TAGS) {
      setErrors((prev) => ({ ...prev, tags: `Не больше ${MAX_TAGS} тегов.` }))
      return
    }
    setTags([...tags, t])
    setTagInput('')
    setErrors((prev) => ({ ...prev, tags: '' }))
  }

  const onTagKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      addTag(tagInput)
    } else if (e.key === 'Backspace' && !tagInput && tags.length > 0) {
      setTags(tags.slice(0, -1))
    }
  }

  const onTagInput = (value: string) => {
    if (value.includes(',')) {
      for (const part of value.split(',')) addTag(part)
      return
    }
    setTagInput(value)
  }
  const [isPaid, setIsPaid] = useState(false)
  const [accessType, setAccessType] = useState<'one-time' | 'subscription'>('one-time')
  const [tierId, setTierId] = useState('')
  const [price, setPrice] = useState('490')
  const [currency, setCurrency] = useState<Currency>(() => prefs.currency)
  const [period, setPeriod] = useState<Paywall['period']>('month')
  const [teaser, setTeaser] = useState('')
  const [coAuthors, setCoAuthors] = useState<string[]>([])
  const [editors, setEditors] = useState<string[]>([])
  const [previewStart, setPreviewStart] = useState('0')
  const [previewEnd, setPreviewEnd] = useState('30')
  const [step, setStep] = useState<1 | 2>(1)
  const [collectionId, setCollectionId] = useState('')
  const [noindex, setNoindex] = useState(false)
  const [scheduleMode, setScheduleMode] = useState<'now' | 'later'>('now')
  const [publishAtInput, setPublishAtInput] = useState('')
  // min для datetime-local вычисляется один раз при монтировании шага
  const [minPublishAt] = useState(() => new Date(Date.now() + 60_000).toISOString().slice(0, 16))
  const [shareLink, setShareLink] = useState('')
  // совместное редактирование: действующая ссылка черновика — редактор автора в той же комнате, что и у рецензентов
  const [sharedToken, setSharedToken] = useState<string | null>(null)
  const [reviewers, setReviewers] = useState<SharedPerson[]>([])
  const [shareError, setShareError] = useState('')
  useEffect(() => {
    if (!draftId || !hasSession()) return
    const load = () =>
      sharedApi.ofDraft(draftId).then((r) => {
        setReviewers(r.reviewers)
        if (r.token) {
          setSharedToken(r.token)
          setShareLink(`${window.location.origin}/shared-draft/${r.token}`)
        }
      }, () => {})
    void load()
    const t = window.setInterval(load, 20_000)
    return () => window.clearInterval(t)
  }, [draftId])
  const [payoutDialogOpen, setPayoutDialogOpen] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})

  // markdown из BlockSuite уже включает карусель/опрос как ```carousel/```poll фенсы
  // (настоящие BlockSuite-блоки, вставляются через "/" — см. src/lib/customBlocks.ts)
  const fullText = bodyText

  // живое оглавление шага 1 по заголовкам ##/### в markdown
  const tocLive = tocFromMarkdown(fullText)

  // клик по TOC в редакторе: точной навигации к heading-блоку в BlockSuite нет,
  // разумно — прокрутить редактор в центр и сфокусировать текст
  const focusEditorFromToc = () => {
    const pe = document.querySelector('.blocksuite-editor page-editor')
    pe?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    ;(pe?.querySelector('affine-page-root') as { focusFirstParagraph?: () => void } | null)?.focusFirstParagraph?.()
  }

  const draft = useMemo<Article>(
    () => ({
      id: 'draft',
      title: title || 'Без заголовка',
      subtitle: subtitle || undefined,
      author: user ? { name: user.name, handle: user.handle, did: user.did } : currentUser,
      publishedAt: new Date().toISOString().slice(0, 10),
      language,
      tags,
      readingTime: Math.max(1, Math.round(fullText.split(/\s+/).filter(Boolean).length / 180)),
      verdict: 'clear',
      excerpt: fullText.replace(/^#\s+.*(?:\n+|$)/, '').split(/\n{2,}/)[0]?.slice(0, 180) ?? '',
      blocks: parseBlocks(fullText),
      comments: [],
      kind,
      collectionId: collectionId || undefined,
      noindex: noindex || undefined,
      publishAt:
        scheduleMode === 'later' && publishAtInput ? new Date(publishAtInput).toISOString() : undefined,
      videoUrl: kind === 'video' && videoMode === 'link' ? videoUrl : undefined,
      videoSource: kind === 'video' ? videoMode : undefined,
      videoFileName: kind === 'video' && videoMode === 'file' ? videoPreview?.file.name : undefined,
      videoDescription: kind === 'video' ? videoDesc.trim() || undefined : undefined,
      videoPreviewRange:
        kind === 'video' && isPaid && previewStart.trim() && previewEnd.trim()
          ? { start: Number(previewStart), end: Number(previewEnd) }
          : undefined,
      teaser: teaser.trim() || undefined,
      // модель хранит один handle на роль; выбор — chips с автодополнением
      coAuthor: coAuthors[0],
      editor: editors[0],
      paywall: (() => {
        if (!isPaid) return undefined
        if (accessType === 'subscription') {
          const tier = tiers.find((t) => t.id === tierId)
          return tier
            ? { price: tier.priceMonthly, currency: tier.currency ?? currency, period: 'month' as const, accessType, tierId: tier.id, tierName: tier.name }
            : undefined
        }
        return { price: Number(price) || 0, currency, period, accessType }
      })(),
    }),
    [title, subtitle, tags, language, fullText, kind, collectionId, noindex, scheduleMode, publishAtInput, videoMode, videoUrl, videoDesc, videoPreview, isPaid, accessType, tierId, tiers, price, currency, period, teaser, coAuthors, editors, previewStart, previewEnd, user],
  )


  const pollIsInvalid = (b: ArticleBlock): boolean => {
    if (b.type !== 'poll') return false
    const { question, options } = parsePoll(b.text)
    const distinct = new Set(options.map((o) => o.trim()).filter(Boolean))
    return question.trim().length < 5 || distinct.size < 2
  }

  // Шаг 1 валиден: осмысленный заголовок + непустой текст + корректные опросы;
  // для видео — в теле должен быть видео-элемент (attachment / YouTube / Loom)
  const step1Valid =
    title.trim().length >= 5 &&
    parseBlocks(fullText).length > 0 &&
    !parseBlocks(fullText).some(pollIsInvalid) &&
    (kind === 'text' || hasVideoEmbed)

  const goStep2 = () => {
    const next: Record<string, string> = {}
    if (title.trim().length < 5) next.title = 'Заголовок короткий — минимум 5 символов.'
    if (parseBlocks(fullText).length === 0) next.body = 'Напишите хотя бы один абзац.'
    if (parseBlocks(fullText).some(pollIsInvalid))
      next.body = 'Опрос неполный: нужен осмысленный вопрос и минимум 2 непустых разных варианта.'
    if (kind === 'video' && !hasVideoEmbed)
      next.body = 'Добавьте видео через / — attachment, YouTube или Loom.'
    setErrors((prev) => ({ ...prev, ...next }))
    if (Object.keys(next).length === 0) {
      setStep(2)
      window.scrollTo({ top: 0 })
    }
  }

  const [publishing, setPublishing] = useState(false)
  const [publishError, setPublishError] = useState('')
  const onPublish = async (e: FormEvent) => {
    e.preventDefault()
    // публикует только кнопка «Опубликовать»: кнопки/Enter внутри блоков редактора форму не отправляют
    const submitter = (e.nativeEvent as SubmitEvent).submitter
    if (!submitter?.hasAttribute('data-publish')) return
    const next: Record<string, string> = {}
    if (title.trim().length < 5) next.title = 'Заголовок короткий — минимум 5 символов.'
    if (kind === 'video' && videoMode === 'link' && !videoUrl.trim()) next.videoUrl = 'Укажите ссылку на видео.'
    if (kind === 'video' && videoMode === 'file' && !videoPreview) next.videoFile = 'Выберите видеофайл или переключитесь на ссылку.'
    if (kind === 'video' && !videoDesc.trim()) next.videoDesc = 'Добавьте описание видео.'
    if (kind === 'text' && parseBlocks(fullText).length === 0) next.body = 'Напишите хотя бы один абзац.'
    if (parseBlocks(fullText).some(pollIsInvalid)) next.body = 'Опрос неполный: нужен осмысленный вопрос и минимум 2 непустых разных варианта.'
    if (kind === 'video' && parseBlocks(fullText).length === 0) next.body = 'Добавьте описание или таймкоды.'
    if (isPaid && !payoutConnected) next.price = 'Выплаты отключены — платная запись не может быть опубликована до повторного подключения.'
    if (isPaid && payoutConnected && accessType === 'one-time' && (!(Number(price) > 0))) next.price = 'Цена должна быть больше нуля.'
    if (isPaid && payoutConnected && accessType === 'subscription' && !tiers.some((t) => t.id === tierId && !t.archived))
      next.price = 'Выберите активный тариф подписки.'
    if (kind === 'video' && isPaid && (previewStart.trim() || previewEnd.trim())) {
      const ps = Number(previewStart)
      const pe = Number(previewEnd)
      if (!previewStart.trim() || !previewEnd.trim() || !Number.isFinite(ps) || !Number.isFinite(pe) || ps < 0 || pe <= ps) {
        next.previewRange = 'Превью: целые секунды, start ≥ 0 и меньше end.'
      }
    }
    if (scheduleMode === 'later') {
      const at = publishAtInput ? new Date(publishAtInput) : null
      if (!at || Number.isNaN(at.getTime()) || at.getTime() <= Date.now())
        next.publishAt = 'Выберите дату и время в будущем.'
    }
    setErrors(next)
    if (Object.keys(next).length > 0) return
    const id = `u-${Date.now()}`
    if (kind === 'video' && videoMode === 'file' && videoPreview) {
      keepSessionVideo(id, videoPreview.url)
    }
    // срок опроса считается от момента публикации (или от отложенной даты)
    const startsAt = draft.publishAt ?? new Date().toISOString()
    const blocks = draft.blocks.map((b) =>
      b.type === 'poll' ? { ...b, text: JSON.stringify({ ...parsePoll(b.text), startsAt }) } : b,
    )
    // в репозиторий — markdown тела без строки-заголовка редактора
    const text = fullText.replace(/^#\s+.*(?:\n+|$)/, '').trim()
    setPublishing(true)
    setPublishError('')
    try {
      const uri = await publishArticle({ ...draft, blocks, id, title: title.trim() }, text, draftId ?? undefined)
      if (importId) await imports.setStatus(importId, 'published', uri).catch(() => {})
      // опубликовано — черновик больше не нужен
      if (draftId) await draftsApi.remove(draftId).catch(() => {})
      navigate(`/article/${id}`)
    } catch (err) {
      // запись не ушла в репозиторий — черновик остаётся в форме, можно повторить
      setPublishError(err instanceof Error ? err.message : 'Не удалось опубликовать. Попробуйте ещё раз.')
    } finally {
      setPublishing(false)
    }
  }

  const field =
    'w-full rounded-md border border-input bg-background px-4 py-3 text-[15px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

  return (
    <div className="mx-auto max-w-[1200px] px-5 pb-24 md:px-8">
      <div className="pt-10">
        <Link
          to="/feed"
          className="inline-flex items-center gap-2 font-mono text-[12px] font-semibold uppercase tracking-[0.08em] text-muted-foreground transition-colors hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ArrowLeft size={13} aria-hidden="true" /> Лента
        </Link>
        <p className="meta mt-8">Новая запись · media.weat.article</p>
        <h1 className="mt-2 text-4xl font-extrabold tracking-tight md:text-5xl">Написать</h1>
        <p className="mt-4 max-w-[64ch] text-[15px] leading-relaxed text-muted-foreground">
          Запись уйдёт в ваш репозиторий — её нельзя отредактировать задним числом без следа и нельзя удалить
          «сверху». Монетизация честная: 90%* с каждой продажи — вам (с Premium — 99%*), остальное — на инфраструктуру
          площадки. <span className="block text-[10px] leading-snug">{FEE_NOTE}</span>
        </p>
      </div>

      <form onSubmit={onPublish} noValidate className="mt-10 max-w-[860px]">
        {/* Шаги: 1 — статья (заголовок и текст), 2 — настройки публикации и предпросмотр */}
        <ol className="flex flex-wrap items-center gap-2" aria-label="Шаги публикации">
          {(
            [
              { n: 1, label: 'Статья' },
              { n: 2, label: 'Публикация' },
            ] as const
          ).map((s) => {
            const active = step === s.n
            const allowed = s.n === 1 || step1Valid
            return (
              <li key={s.n}>
                <button
                  type="button"
                  onClick={() => {
                    if (allowed) {
                      setStep(s.n)
                      window.scrollTo({ top: 0 })
                    }
                  }}
                  disabled={!allowed}
                  aria-current={active ? 'step' : undefined}
                  className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 font-mono text-[12px] font-semibold uppercase tracking-[0.05em] transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                    active
                      ? 'border-primary bg-primary text-primary-foreground'
                      : allowed
                        ? 'cursor-pointer border-border text-foreground hover:border-accent hover:text-accent'
                        : 'cursor-not-allowed border-border text-muted-foreground opacity-60'
                  }`}
                >
                  <span className="opacity-70">{s.n}.</span> {s.label}
                </button>
              </li>
            )
          })}
        </ol>

        {step === 1 ? (
          <Reveal key="article-step" className="mt-8 space-y-6">
          {/* Тип контента — выбирается на первом шаге, до текста; детали видео/монетизации — на шаге 2 */}
          <div role="radiogroup" aria-label="Тип контента" className="flex flex-wrap gap-3">
            {(
              [
                { key: 'text', label: 'Статья', icon: FileText },
                { key: 'video', label: 'Видео', icon: Clapperboard },
              ] as const
            ).map((opt) => (
              <button
                key={opt.key}
                type="button"
                role="radio"
                aria-checked={kind === opt.key}
                onClick={() => setKind(opt.key)}
                className={`inline-flex cursor-pointer items-center gap-2 rounded-full border px-4 py-2 font-mono text-[13px] font-semibold uppercase tracking-[0.05em] transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  kind === opt.key
                    ? 'border-accent bg-accent text-accent-foreground'
                    : 'border-border text-foreground hover:border-accent hover:text-accent'
                }`}
              >
                <opt.icon size={14} aria-hidden="true" /> {opt.label}
              </button>
            ))}
          </div>

          {/* Заголовок — внутри BlockSuite-редактора: page-title (doc-title) над текстом,
              сериализуется в markdown как `# Title`; отдельного input больше нет */}
          <div className="xl:grid xl:grid-cols-[minmax(0,1fr)_220px] xl:gap-8">
          <div>
            <span className="meta" id="bodyLabel">Заголовок и текст</span>
            <div className="mt-2" aria-labelledby="bodyLabel">
              {importReady ? <BlocksEditor
                key={sharedToken ?? 'solo'}
                serverRoom={sharedToken ? { token: sharedToken, isOwner: true } : undefined}
                value={bodyText}
                title={title}
                onContentInspect={(info) => setHasVideoEmbed(info.hasVideo)}
                onTitleChange={(t) => {
                  setTitle(t)
                  if (errors.title) setErrors((prev) => ({ ...prev, title: '' }))
                }}
                onChange={(md) => {
                  setBodyText(md)
                  if (errors.body) setErrors((prev) => ({ ...prev, body: '' }))
                }}
              /> : <p className="meta py-10">Загружаем черновик…</p>}
              <p className="meta mt-2">
                заголовок — первая строка редактора; карусель и опрос — через «/» в тексте
                {draftSaved && <> · черновик сохранён {draftSaved} · <Link to="/settings/drafts" className="underline underline-offset-2">все черновики</Link></>}
              </p>
            </div>
            {errors.title && <p className="mt-2 text-sm text-destructive">{errors.title}</p>}
            {errors.body && <p className="mt-2 text-sm text-destructive">{errors.body}</p>}
          </div>
          {/* Живое оглавление: те же slug-правила, что и у статьи; клик прокручивает к редактору */}
          {tocLive.length > 0 && (
            <aside className="mt-4 xl:mt-0">
              <div className="xl:sticky xl:top-24">
                <ArticleToc items={tocLive} onNavigate={focusEditorFromToc} />
              </div>
            </aside>
          )}
          </div>

            <div className="flex flex-wrap items-center gap-3">
              <button type="button" onClick={goStep2} className="btn-primary">
                Далее: настройки публикации
              </button>
              <p className="meta">черновик между шагами не теряется</p>
            </div>
          </Reveal>
        ) : (
          <Reveal key="publish-step" className="mt-8 space-y-5">
          {/* Тип контента выбран на шаге 1 */}
          <p className="meta inline-flex items-center gap-1.5">
            {kind === 'video' ? <Clapperboard size={12} aria-hidden="true" /> : <FileText size={12} aria-hidden="true" />}
            тип: {kind === 'video' ? 'видео' : 'статья'} — меняется на первом шаге
          </p>


                      <div>
            <label htmlFor="subtitle" className="meta">Подзаголовок</label>
            <input
              id="subtitle"
              value={subtitle}
              onChange={(e) => setSubtitle(e.target.value)}
              className={`${field} mt-2`}
              placeholder="Необязательно: что узнает читатель"
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="co-author" className="meta">Соавтор</label>
              <div className="mt-2">
                <PeopleAutocomplete
                  id="co-author"
                  candidates={peopleCandidates}
                  selected={coAuthors}
                  onChange={setCoAuthors}
                  placeholder="Необязательно: @handle соавтора"
                  onError={(m) => setErrors((prev) => ({ ...prev, coAuthor: m }))}
                />
              </div>
              {errors.coAuthor && <p className="mt-2 text-sm text-destructive">{errors.coAuthor}</p>}
            </div>
            <div>
              <label htmlFor="editor" className="meta">Редактор</label>
              <div className="mt-2">
                <PeopleAutocomplete
                  id="editor"
                  candidates={peopleCandidates}
                  selected={editors}
                  onChange={setEditors}
                  placeholder="Необязательно: @handle редактора"
                  onError={(m) => setErrors((prev) => ({ ...prev, editor: m }))}
                />
              </div>
              {errors.editor && <p className="mt-2 text-sm text-destructive">{errors.editor}</p>}
            </div>
          </div>


                      {kind === 'video' && (
            <div className="space-y-5">
              <div>
                <span className="meta">Источник видео</span>
                <div
                  role="tablist"
                  aria-label="Способ добавления видео"
                  className="mt-2 inline-flex rounded-full border border-border bg-secondary/60 p-1"
                >
                  {(
                    [
                      { key: 'link', label: 'Ссылка' },
                      { key: 'file', label: 'Файл' },
                    ] as const
                  ).map((tab) => (
                    <button
                      key={tab.key}
                      type="button"
                      role="tab"
                      aria-selected={videoMode === tab.key}
                      onClick={() => setVideoMode(tab.key)}
                      className={`cursor-pointer rounded-full px-4 py-1.5 font-mono text-[12px] font-semibold uppercase tracking-[0.05em] transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                        videoMode === tab.key ? 'bg-primary text-primary-foreground' : 'text-foreground hover:text-accent'
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
              </div>

              {videoMode === 'link' ? (
                <div>
                  <label htmlFor="videoUrl" className="meta">Ссылка на видео</label>
                  <input
                    id="videoUrl"
                    value={videoUrl}
                    onChange={(e) => setVideoUrl(e.target.value)}
                    className={`${field} mt-2 font-mono text-sm`}
                    placeholder="https://… — YouTube, Loom или файл .mp4; пусто — демо-ролик"
                  />
                  {errors.videoUrl && <p className="mt-2 text-sm text-destructive">{errors.videoUrl}</p>}
                </div>
              ) : (
                <div>
                  <span className="meta" id="videoFileLabel">Видеофайл</span>
                  <div
                    role="button"
                    tabIndex={0}
                    aria-labelledby="videoFileLabel"
                    onClick={() => document.getElementById('videoFile')?.click()}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        document.getElementById('videoFile')?.click()
                      }
                    }}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={onVideoDrop}
                    className="mt-2 flex cursor-pointer flex-col items-center gap-2 rounded-md border border-dashed border-border bg-secondary/40 px-5 py-8 text-center transition-colors hover:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <UploadCloud size={20} className="text-accent" aria-hidden="true" />
                    <span className="meta !normal-case tracking-normal">
                      файл живёт только в этой вкладке и в ленту сети не попадёт — для публикации дайте ссылку
                    </span>
                    <span className="text-sm text-muted-foreground">
                      Перетащите видео сюда или нажмите, чтобы выбрать · до {formatFileSize(MAX_VIDEO_SIZE)}
                    </span>
                    <input
                      id="videoFile"
                      type="file"
                      accept="video/*"
                      className="hidden"
                      onChange={(e) => {
                        selectVideoFile(e.target.files?.[0] ?? null)
                        e.target.value = ''
                      }}
                    />
                  </div>
                  {errors.videoFile && <p className="mt-2 text-sm text-destructive">{errors.videoFile}</p>}
                  {videoPreview && (
                    <div className="mt-3">
                      <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-background px-4 py-2.5">
                        <p className="min-w-0 font-mono text-[13px]">
                          <Clapperboard size={13} className="mr-2 inline text-accent" aria-hidden="true" />
                          <span className="break-all">{videoPreview.file.name}</span>
                          <span className="meta ml-2">{formatFileSize(videoPreview.file.size)}</span>
                        </p>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => document.getElementById('videoFile')?.click()}
                            className="btn-ghost !px-3 !py-1.5 !text-[11px]"
                          >
                            Заменить
                          </button>
                          <button
                            type="button"
                            onClick={clearVideoFile}
                            aria-label="Удалить файл"
                            title="Удалить файл"
                            className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-full border border-border transition-colors hover:border-destructive hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            <X size={13} aria-hidden="true" />
                          </button>
                        </div>
                      </div>
                      <VideoPlayer src={videoPreview.url} title={videoPreview.file.name} />
                    </div>
                  )}
                  <p className="meta mt-2">
                    файл не уходит на сервер: воспроизводится локально и доступен только в этой сессии вкладки
                  </p>
                </div>
              )}

              <div>
                <label htmlFor="videoDesc" className="meta">Описание видео</label>
                <textarea
                  id="videoDesc"
                  value={videoDesc}
                  onChange={(e) => {
                    setVideoDesc(e.target.value)
                    if (errors.videoDesc) setErrors((prev) => ({ ...prev, videoDesc: '' }))
                  }}
                  rows={3}
                  className={`${field} mt-2 resize-y`}
                  placeholder={'О чём это видео. Таймкоды станут кликабельными:\n0:00 — вступление\n01:35 — главное\n1:02:10 — ответы на вопросы'}
                />
                <p className="meta mt-2">
                  таймкоды вида 00:00, 01:35 или 1:02:10 на странице записи перематывают плеер
                </p>
                {errors.videoDesc && <p className="mt-2 text-sm text-destructive">{errors.videoDesc}</p>}
              </div>
            </div>
          )}


                      {/* Монетизация */}
          <div className="rounded-md border border-border bg-secondary/50 p-5">
            <button
              type="button"
              role="switch"
              aria-checked={isPaid}
              onClick={() => {
                if (!isPaid && !payoutConnected) {
                  setPayoutDialogOpen(true)
                  return
                }
                setIsPaid(!isPaid)
              }}
              className="flex w-full cursor-pointer items-center justify-between gap-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="inline-flex items-center gap-2 font-mono text-[13px] font-semibold uppercase tracking-[0.06em]">
                <Lock size={13} className="text-accent" aria-hidden="true" /> Платный контент
                {!payoutConnected && <span className="meta !normal-case tracking-normal text-muted-foreground">выплаты не настроены</span>}
              </span>
              <span
                className={`relative h-7 w-12 shrink-0 rounded-full transition-colors duration-200 ${isPaid ? 'bg-accent' : 'bg-border'}`}
                aria-hidden="true"
              >
                <span
                  className={`absolute left-0 top-1 h-5 w-5 rounded-full bg-background shadow transition-transform duration-200 ${
                    isPaid ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </span>
            </button>

            <Dialog open={payoutDialogOpen} onOpenChange={setPayoutDialogOpen}>
              <DialogContent className="sm:max-w-md">
                <DialogHeader>
                  <DialogTitle>Выплаты не настроены</DialogTitle>
                  <DialogDescription>
                    Платные посты доступны авторам только после подключения реквизитов выплат — 90%* каждой
                    продажи (с Premium — 99%*) уходит на них. <span className="block text-[10px] leading-snug">{FEE_NOTE}</span> Читатели платят через lava.top; реквизиты хранятся в вашем аккаунте, выплаты на них делает площадка.
                  </DialogDescription>
                </DialogHeader>
                <div className="flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      setPayoutDialogOpen(false)
                      navigate(
                        `/profile/${user?.handle ?? 'you.judge.dev'}/settings/payouts?returnTo=/compose`,
                      )
                    }}
                    className="btn-primary !px-4 !py-2"
                  >
                    Перейти в настройки выплат
                  </button>
                  <button
                    type="button"
                    onClick={() => setPayoutDialogOpen(false)}
                    className="btn-ghost !px-4 !py-2"
                  >
                    Не сейчас
                  </button>
                </div>
              </DialogContent>
            </Dialog>
            {isPaid && (
              <div className="mt-4">
                <div className="flex flex-wrap gap-2" role="group" aria-label="Тип доступа">
                  {(
                    [
                      { key: 'one-time', label: 'Одноразовая покупка' },
                      { key: 'subscription', label: 'Тир подписки' },
                    ] as const
                  ).map((opt) => (
                    <button
                      key={opt.key}
                      type="button"
                      onClick={() => setAccessType(opt.key)}
                      aria-pressed={accessType === opt.key}
                      className={`cursor-pointer rounded-full border px-4 py-1.5 font-mono text-[12px] font-semibold uppercase tracking-[0.05em] transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                        accessType === opt.key ? 'border-primary bg-primary text-primary-foreground' : 'border-border text-foreground hover:border-accent hover:text-accent'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>

                {accessType === 'one-time' ? (
                  <div className="mt-4 flex flex-wrap items-end gap-4">
                    <div>
                      <label htmlFor="price" className="meta">Цена</label>
                      <input
                        id="price"
                        type="number"
                        min="1"
                        value={price}
                        onChange={(e) => setPrice(e.target.value)}
                        className={`${field} mt-2 !w-32 font-mono text-sm`}
                      />
                    </div>
                    <div>
                      <label htmlFor="currency" className="meta">Валюта</label>
                      <select
                        id="currency"
                        value={currency}
                        onChange={(e) => setCurrency(e.target.value as Currency)}
                        className={`${field} mt-2 cursor-pointer font-mono text-sm`}
                      >
                        {CURRENCIES.map((c) => <option key={c.code} value={c.code}>{c.code}</option>)}
                      </select>
                    </div>
                    <div>
                      <label htmlFor="period" className="meta">Период</label>
                      <select
                        id="period"
                        value={period}
                        onChange={(e) => setPeriod(e.target.value as Paywall['period'])}
                        className={`${field} mt-2 cursor-pointer font-mono text-sm`}
                      >
                        <option value="month">Подписка /мес</option>
                        <option value="once">Разовая покупка</option>
                      </select>
                    </div>
                    <p className="meta pb-3">автор получит 90%</p>
                  </div>
                ) : (
                  <div className="mt-4">
                    <label htmlFor="tier" className="meta">Тарифный уровень</label>
                    {tiers.filter((t) => !t.archived).length === 0 ? (
                      <p className="mt-2 text-sm text-muted-foreground">
                        Активных тарифов нет —{' '}
                        <Link
                          to={`/profile/${user?.handle ?? 'you.judge.dev'}/settings/payouts?returnTo=/compose`}
                          className="font-semibold text-accent underline-offset-4 hover:underline"
                        >
                          создайте тариф в настройках выплат
                        </Link>
                        .
                      </p>
                    ) : (
                      <select
                        id="tier"
                        value={tierId}
                        disabled={!payoutConnected}
                        onChange={(e) => setTierId(e.target.value)}
                        className={`${field} mt-2 cursor-pointer font-mono text-sm disabled:cursor-not-allowed disabled:opacity-60`}
                      >
                        <option value="">Выберите тариф…</option>
                        {tiers.filter((t) => !t.archived).map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name} · {formatMoney(t.priceMonthly, t.currency ?? 'RUB')}/мес
                          </option>
                        ))}
                      </select>
                    )}
                    <p className="meta mt-2">подписчик тира получает доступ ко всем записям уровня; 90%* — вам (с Premium — 99%*)</p>
                    {!payoutConnected && (
                      <p className="meta mt-2 !normal-case tracking-normal text-muted-foreground">
                        провайдер выплат отключён — тарифы сохранены, но неактивны; выбрать или создать тариф
                        можно после{' '}
                        <Link
                          to={`/profile/${user?.handle ?? 'you.judge.dev'}/settings/payouts?returnTo=/compose`}
                          className="font-semibold text-accent underline-offset-4 hover:underline"
                        >
                          повторного подключения выплат
                        </Link>
                      </p>
                    )}
                  </div>
                )}
                {errors.price && <p className="mt-2 text-sm text-destructive">{errors.price}</p>}
              </div>
            )}
            {isPaid && kind === 'video' && (
              <div className="mt-4">
                <span className="meta" id="previewRangeLabel">Бесплатное превью видео, секунды</span>
                <div className="mt-2 flex flex-wrap items-center gap-3" role="group" aria-labelledby="previewRangeLabel">
                  <input
                    type="number"
                    min="0"
                    value={previewStart}
                    onChange={(e) => {
                      setPreviewStart(e.target.value)
                      if (errors.previewRange) setErrors((prev) => ({ ...prev, previewRange: '' }))
                    }}
                    aria-label="Начало превью, секунды"
                    className={`${field} !w-24 font-mono text-sm`}
                  />
                  <span className="meta">—</span>
                  <input
                    type="number"
                    min="0"
                    value={previewEnd}
                    onChange={(e) => {
                      setPreviewEnd(e.target.value)
                      if (errors.previewRange) setErrors((prev) => ({ ...prev, previewRange: '' }))
                    }}
                    aria-label="Конец превью, секунды"
                    className={`${field} !w-24 font-mono text-sm`}
                  />
                </div>
                {errors.previewRange && <p className="mt-2 text-sm text-destructive">{errors.previewRange}</p>}
                <p className="meta mt-2">
                  не купившие увидят только этот отрезок; очистите оба поля, если превью не нужно
                </p>
              </div>
            )}
          </div>


                      {/* Тизер — для любой публикации; у платной показывается вместо тела до покупки */}
          <div>
            <label htmlFor="teaser" className="meta">Тизер (необязательно)</label>
            <textarea
              id="teaser"
              value={teaser}
              onChange={(e) => setTeaser(e.target.value)}
              rows={3}
              className={`${field} mt-2 resize-y`}
              placeholder="2–3 предложения о записи: покажется над текстом; у платной — вместо неё до покупки"
            />
            <p className="meta mt-2">
              редакционный хук: у видео — в дополнение к описанию, у платной статьи — единственное, что видно до покупки
            </p>
          </div>


                      <div>
            <label htmlFor="tags" className="meta">Теги · до {MAX_TAGS}, свои разрешены</label>
            <div className="mt-2 flex flex-wrap items-center gap-2 rounded-md border border-input bg-background px-3 py-2 focus-within:ring-2 focus-within:ring-ring">
              {tags.map((t) => (
                <span
                  key={t}
                  className="inline-flex items-center gap-1.5 rounded-full border border-border bg-secondary/60 px-2.5 py-1 font-mono text-[12px] font-semibold"
                >
                  #{t}
                  <button
                    type="button"
                    onClick={() => setTags(tags.filter((x) => x !== t))}
                    aria-label={`Удалить тег ${t}`}
                    className="cursor-pointer text-muted-foreground transition-colors hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <X size={11} aria-hidden="true" />
                  </button>
                </span>
              ))}
              <input
                id="tags"
                value={tagInput}
                onChange={(e) => onTagInput(e.target.value)}
                onKeyDown={onTagKeyDown}
                onBlur={() => addTag(tagInput)}
                className="min-w-28 flex-1 bg-transparent py-1 font-mono text-sm focus-visible:outline-none"
                placeholder={tags.length === 0 ? 'rust, perfscale…' : ''}
                aria-describedby="tagsHint"
              />
            </div>
            <p id="tagsHint" className="meta mt-2">
              Enter или запятая — добавить; приводим к lowercase, свои теги попадут в фильтр ленты
            </p>
            {errors.tags && <p className="mt-2 text-sm text-destructive">{errors.tags}</p>}
          </div>


                      <div>
            <label htmlFor="language" className="meta">Язык публикации</label>
            <select
              id="language"
              value={language}
              onChange={(e) => setLanguage(e.target.value as ArticleLanguage)}
              className={`${field} mt-2 cursor-pointer font-mono text-sm`}
            >
              {LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.name} · {l.code}
                </option>
              ))}
            </select>
            <p className="meta mt-2">в списке работает быстрый набор первой буквы названия</p>
          </div>


            <div>
              <label htmlFor="collection" className="meta">Подборка (необязательно)</label>
              <select
                id="collection"
                value={collectionId}
                onChange={(e) => setCollectionId(e.target.value)}
                className={`${field} mt-2 cursor-pointer font-mono text-sm`}
              >
                <option value="">Без подборки</option>
                {collections.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title} · @{c.authorHandle}
                  </option>
                ))}
              </select>
              <p className="meta mt-2">запись останется в вашем архиве; подборка лишь собирает маршрут чтения</p>
            </div>

            <div>
              <span className="meta">Время публикации</span>
              <div
                role="tablist"
                aria-label="Время публикации"
                className="mt-2 inline-flex rounded-full border border-border bg-secondary/60 p-1"
              >
                {(
                  [
                    { key: 'now', label: 'Сейчас' },
                    { key: 'later', label: 'По расписанию' },
                  ] as const
                ).map((t) => (
                  <button
                    key={t.key}
                    type="button"
                    role="tab"
                    aria-selected={scheduleMode === t.key}
                    onClick={() => setScheduleMode(t.key)}
                    className={`cursor-pointer rounded-full px-4 py-1.5 font-mono text-[12px] font-semibold uppercase tracking-[0.05em] transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                      scheduleMode === t.key ? 'bg-primary text-primary-foreground' : 'text-foreground hover:text-accent'
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
              {scheduleMode === 'later' && (
                <div className="mt-3">
                  <label htmlFor="publishAt" className="meta">Дата и время</label>
                  <input
                    id="publishAt"
                    type="datetime-local"
                    value={publishAtInput}
                    min={minPublishAt}
                    onChange={(e) => {
                      setPublishAtInput(e.target.value)
                      if (errors.publishAt) setErrors((prev) => ({ ...prev, publishAt: '' }))
                    }}
                    className={`${field} mt-2 font-mono text-sm`}
                  />
                  {errors.publishAt && <p className="mt-2 text-sm text-destructive">{errors.publishAt}</p>}
                  <p className="meta mt-2">
                    запись появится в ленте автоматически, когда время наступит (publishAt)
                  </p>
                </div>
              )}
            </div>

            <label className="flex items-start gap-2.5 text-sm">
              <input type="checkbox" checked={noindex} onChange={(e) => setNoindex(e.target.checked)} className="mt-0.5" />
              <span>
                Не индексировать поисковиками
                <span className="meta mt-0.5 block !normal-case tracking-normal">
                  статья останется в ленте и по ссылке, но Google и Яндекс не покажут её в поиске (robots: noindex)
                </span>
              </span>
            </label>

            <div className="rule pt-6">
              <p className="meta mb-3">Предпросмотр всей статьи</p>
              <Preview article={draft} />
            </div>

                      <div className="flex flex-wrap items-center gap-3">
            {publishError && (
              <p role="alert" className="w-full text-sm text-destructive">
                {publishError}
              </p>
            )}
            <button type="submit" data-publish className="btn-primary" disabled={publishing}>
              {publishing ? 'Публикуем…' : 'Опубликовать в репозиторий'}
            </button>
            <button
              type="button"
              onClick={async () => {
                setShareError('')
                if (!draftId) return setShareError('Черновик ещё не сохранён: напишите пару слов и подождите 2 секунды')
                try {
                  const { token } = await sharedApi.create(draftId)
                  setSharedToken(token)
                  setShareLink(`${window.location.origin}/shared-draft/${token}`)
                } catch (e) {
                  setShareError(e instanceof Error ? e.message : 'Не удалось создать ссылку')
                }
              }}
              className="btn-ghost"
            >
              <Share2 size={14} aria-hidden="true" /> Совместное редактирование
            </button>
          </div>
          {shareLink && (
            <p className="border border-dashed border-accent bg-secondary/40 p-4 font-mono text-[12px]">
              <span className="meta block">ссылка на 24 ч · открыть и править могут вошедшие пользователи · кто поменял текст — рецензент</span>
              <a href={shareLink} target="_blank" rel="noreferrer" className="mt-1 inline-block break-all text-accent underline underline-offset-4">
                {shareLink}
              </a>
              <span className="meta mt-2 block !normal-case tracking-normal">
                Рецензенты: {reviewers.length ? reviewers.map((r) => r.displayName || (r.handle ? `@${r.handle}` : r.did)).join(', ') : 'пока никто не правил'}
              </span>
            </p>
          )}
          {shareError && <p role="alert" className="text-sm text-destructive">{shareError}</p>}
        </Reveal>
        )}
      </form>
    </div>
  )
}
