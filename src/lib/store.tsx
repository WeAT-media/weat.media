import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type {
  Article,
  CaseFile,
  Collection,
  Comment,
  EditorPreferences,
  LabelAction,
  LabelerSettings,
  Preferences,
  Report,
  SubscriptionTier,
  SupportTicket,
  User,
  VoteValue,
  ReadEntry,
  VideoProgressEntry,
} from '@/types/types'
import type { NotificationPreferences } from '@/lib/api'
import { defaultEditorPreferences, defaultPreferences } from '@/types/types'
// статьи, дела и подборки — только настоящие (индекс ленты и свои); из моков — модераторы и аноним
import { currentUser as anonUser, labelers as seedLabelers } from '@/data/mock'

import type { BlockDef } from '@/lib/userBlocks'
import { currencyForCountry } from '@/lib/money'
import { api, toUser, articles as articlesApi, clearSession, comments, SESSION_ENDED_EVENT, SESSION_STORAGE_KEY, hasSession, likes, notifications as notificationsApi, support as supportApi, type ServerSettings } from '@/lib/api'
import { videoFromLink, type RecordVideo } from '@/lib/videoLink'

type SettingsSection = keyof ServerSettings

/** страны, где интерфейс по умолчанию русский; остальные — английский */
const RU_LANG_COUNTRIES = new Set(['RU', 'BY', 'KZ', 'KG', 'TJ', 'UZ', 'AM', 'AZ', 'MD', 'TM'])
const langForCountry = (country: string): Preferences['uiLang'] => (RU_LANG_COUNTRIES.has(country) ? 'ru' : 'en')
/** local — аноним/демо, настройки только в браузере */
export type SettingsSyncState = 'local' | 'syncing' | 'saved' | 'error'
import { setEditorCaps } from '@/lib/editorCaps'
import { setEditorPeople } from '@/lib/editorPeople'
import { profileMetaSeed } from '@/data/profiles'
import { PDS_URL } from '@/config/site'
import { fetchRemoteFeed, remoteId, toComment } from '@/lib/remoteFeed'

const STORAGE_KEY = 'indie-media:v1'
/** столько же принимает сервер (server/src/settings.ts) */
const VIDEO_PROGRESS_MAX = 200
const HISTORY_MAX = 200

function mergeProgress(a: Record<string, VideoProgressEntry> = {}, b: Record<string, VideoProgressEntry> = {}) {
  const out = { ...a }
  for (const [k, v] of Object.entries(b)) if (!out[k] || out[k].at < v.at) out[k] = v
  return Object.fromEntries(Object.entries(out).sort((x, y) => y[1].at - x[1].at).slice(0, VIDEO_PROGRESS_MAX))
}

function mergeHistory(a: ReadEntry[] = [], b: ReadEntry[] = []) {
  const byId = new Map<string, ReadEntry>()
  for (const e of [...a, ...b]) {
    const cur = byId.get(e.id)
    if (!cur || cur.at < e.at) byId.set(e.id, e)
  }
  return [...byId.values()].sort((x, y) => y.at - x.at).slice(0, HISTORY_MAX)
}

interface Persisted {
  settings: Record<string, LabelerSettings>
  votes: Record<string, VoteValue>
  extraArticles: Article[]
  extraComments: Record<string, Comment[]>
  unlocked: Record<string, boolean>
  user: User | null
  extraCollections: Collection[]
  extraCases: CaseFile[]
  /** token -> черновик для временной ссылки рецензирования */
  sharedDrafts: Record<string, { article: Article; createdAt: string }>
  /** articleId -> индекс выбранной опции опроса */
  /** pollKey (articleId#index) -> выбранные варианты; старые данные: articleId -> число */
  pollVotes: Record<string, number | number[]>
  /** pollKey -> когда автор остановил приём ответов */
  pollClosed: Record<string, string>
  /** handle -> подписка читателя (мок follow) */
  following: string[]
  /** id прочитанных уведомлений */
  readNotifications: string[]
  /** читатель отказался быть присяжным */
  juryOptOut: boolean
  /** автор подключил реквизиты выплат (локальный мок) */
  payoutConnected: boolean
  /** страна резидентства для выплат ('RU', 'KZ', ..., 'other') */
  payoutCountry: string
  /** способ выплат: фиат или крипта (крипта недоступна резидентам РФ) */
  payoutMethod: 'fiat' | 'crypto'
  /** крипто-актив выплат (USDT/TON/BTC/ETH) */
  payoutAsset: string
  /** сеть крипто-выплат (валидная пара к активу) */
  payoutNetwork: string
  /** адрес крипто-кошелька для выплат (только публичный адрес, никогда не seed/keys) */
  cryptoAddress: string
  /** жалобы на статьи/комментарии/пользователей */
  reports: Report[]
  /** handle -> подписка на новые статьи автора (не путать с follow) */
  authorSubscriptions: string[]
  /** articleId -> читатель следит за обновлениями комментариев */
  watchedArticles: string[]
  /** обращения в поддержку (локальные демо-тикеты) */
  supportTickets: SupportTicket[]
  /** тарифные уровни подписки текущего пользователя (демо, глобально для прототипа) */
  tiers: SubscriptionTier[]
  /** articleId -> читатель поднял статью (upvote; downvote на платформе нет) */
  upvotes: string[]
  /** articleId -> в закладках у читателя */
  bookmarks: string[]
  /** «продолжить с места»: ключ ролика → позиция; синхронизируется с аккаунтом */
  videoProgress: Record<string, VideoProgressEntry>
  /** история прочтений, новые сверху (до HISTORY_MAX) */
  readHistory: ReadEntry[]
  prefs: Preferences
  notificationPrefs: NotificationPreferences
  /** пользователь сам выбрал язык интерфейса; иначе язык берётся по региону */
  uiLangExplicit?: boolean
  /** пользователь сам выбрал валюту; иначе валюта по стране */
  currencyExplicit?: boolean
  /** premium-настройки редактора (кастомные блоки, дефолты callout) */
  editorPrefs: EditorPreferences
  /** свои блоки автора (Premium, конструктор/код) */
  blockDefs: BlockDef[]
  ai: { openrouterKey: string; model: string }
}

interface StoreValue extends Persisted {
  articles: Article[]
  cases: CaseFile[]
  collections: Collection[]
  isPremium: boolean
  settingsSync: SettingsSyncState
  login: (u?: User) => void
  logout: () => void
  setPremium: (v: boolean) => void
  saveAi: (key: string, model: string) => void
  toggleSubscription: (labelerId: string) => void
  setLabelAction: (labelerId: string, labelValue: string, action: LabelAction) => void
  castVote: (caseId: string, vote: VoteValue) => void
  castPollVote: (pollKey: string, optionIndexes: number[]) => void
  retractPollVote: (pollKey: string) => void
  closePoll: (pollKey: string) => void
  toggleUpvote: (articleId: string) => void
  toggleBookmark: (articleId: string) => void
  /** позиция ролика для других устройств; t = 0 — досмотрен или начат заново, запись убираем */
  syncVideoProgress: (key: string, t: number, d?: number) => void
  /** открыл статью — в начало истории (если история включена) */
  recordRead: (article: Article) => void
  clearHistory: () => void
  toggleFollow: (handle: string) => void
  markNotificationsRead: (ids: string[]) => void
  setJuryOptOut: (v: boolean) => void
  setPayoutConnected: (v: boolean) => void
  /** сохранить параметры выплат (страна, метод, актив/сеть/адрес) без потери остального */
  setPayoutDetails: (patch: Partial<Pick<Persisted, 'payoutCountry' | 'payoutMethod' | 'payoutAsset' | 'payoutNetwork' | 'cryptoAddress'>>) => void
  saveTier: (t: SubscriptionTier) => void
  deleteTier: (id: string) => void
  addReport: (r: Omit<Report, 'id' | 'createdAt' | 'status'>) => Report
  /** обращение уходит на сервер (номер — его); копия — в браузере заявителя. Ошибка API пробрасывается */
  addSupportTicket: (t: Omit<SupportTicket, 'id' | 'createdAt' | 'status'> & { status?: SupportTicket['status'] }) => Promise<SupportTicket>
  setPrefs: (patch: Partial<Preferences>) => void
  setNotificationPrefs: (patch: Partial<NotificationPreferences>) => void
  setEditorPrefs: (patch: Partial<EditorPreferences>) => void
  setBlockDefs: (defs: BlockDef[]) => void
  /**
   * text — markdown для репозитория. С сессией бесплатная запись (не отложенная) уходит в PDS, и копия
   * в браузере получает настоящий AT URI; ошибка API пробрасывается. Без сессии, платная, отложенная
   * или видео-файл (его некуда загрузить) — только локально.
   */
  /** uri записи в репозитории; undefined — статья осталась локальной (платная, отложенная, без сессии) */
  publishArticle: (article: Article, text?: string, draftId?: string) => Promise<string | undefined>
  /** убрать свою статью из копии этого браузера (удалена в периоде охлаждения) */
  forgetArticle: (atUri: string) => void
  /** у статьи из индекса — запись в репозиторий читателя; ошибка API пробрасывается (ApiError) */
  addComment: (articleId: string, text: string, parentId?: string) => Promise<void>
  /** свой комментарий: из репозитория читателя (AT URI) или локальный; ошибка API пробрасывается */
  deleteComment: (articleId: string, commentId: string) => Promise<void>
  toggleAuthorSubscription: (handle: string) => void
  toggleWatchArticle: (articleId: string) => void
  unlock: (articleId: string) => void
  createCollection: (title: string, description: string) => Collection
  addToCollection: (collectionId: string, articleId: string) => void
  /** «Вынести статью на суд» — создаёт дело, возвращает его id */
  reportToCourt: (articleId: string, claim: { collegiumId: string; labelValue: string; charges: string }) => string
  /** Передача прав от краулера автору (репост -> своя запись) */
  transferRights: (articleId: string) => void
  shareDraft: (article: Article) => string
  caseStats: (c: CaseFile) => {
    guilty: number
    clear: number
    voted: number
    closed: boolean
    outcome: VoteValue | null
    myVote?: VoteValue
    /** вес моего голоса: premium = 1.5 */
    myWeight: number
  }
  actionForLabel: (labelValue: string) => LabelAction | null
}

const StoreContext = createContext<StoreValue | null>(null)

function loadPersisted(): Persisted {
  const defaults: Persisted = {
    settings: {},
    votes: {},
    extraArticles: [],
    extraComments: {},
    unlocked: {},
    user: null,
    extraCollections: [],
    extraCases: [],
    sharedDrafts: {},
    pollVotes: {},
    pollClosed: {},
    upvotes: [],
    bookmarks: [],
    videoProgress: {},
    readHistory: [],
    following: [],
    readNotifications: [],
    juryOptOut: false,
    payoutConnected: false,
    payoutCountry: 'RU',
    payoutMethod: 'fiat',
    payoutAsset: 'USDT',
    payoutNetwork: 'TRC20',
    cryptoAddress: '',
    tiers: [
      {
        id: 'tier-basic',
        name: 'Подписчик',
        priceMonthly: 299,
        description: 'Все платные записи и видео автора каждый месяц.',
      },
      {
        id: 'tier-patron',
        name: 'Патрон',
        priceMonthly: 999,
        description: 'Всё из «Подписчика» + ранние черновики и закрытые заметки.',
      },
    ],
    reports: [],
    authorSubscriptions: [],
    watchedArticles: [],
    supportTickets: [],
    prefs: defaultPreferences,
    notificationPrefs: { articles: true, comments: true, replies: true },
    editorPrefs: defaultEditorPreferences,
    blockDefs: [],
    ai: { openrouterKey: '', model: 'openrouter/free' },
  }
  try {
    if (typeof localStorage === 'undefined') return defaults
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return defaults
    const data = { ...defaults, ...JSON.parse(raw) }
    // новые поля настроек появляются со временем: дополняем сохранённое значениями по умолчанию
    data.prefs = { ...defaultPreferences, ...data.prefs }
    data.editorPrefs = { ...defaultEditorPreferences, ...data.editorPrefs }
    // миграция: статьи из этого браузера раньше публиковались от демо-автора —
    // переписываем на вошедшего пользователя (демо-аккаунт оставляем как есть)
    if (data.user && data.user.handle !== anonUser.handle) {
      const me = { name: data.user.name, handle: data.user.handle, did: data.user.did }
      data.extraArticles = (data.extraArticles as Article[]).map((a) =>
        a.id.startsWith('u-') && a.author.handle === anonUser.handle ? { ...a, author: me } : a,
      )
    }
    // миграция: демо-аккаунт you.judge.dev всегда Premium
    if (data.user?.handle === anonUser.handle && !data.user.premium) {
      data.user = { ...data.user, premium: true, premiumSinceMonths: 8 }
    }
    return data
  } catch {
    return defaults
  }
}

function initialSettings(persisted: Record<string, LabelerSettings>): Record<string, LabelerSettings> {
  // новые коллегии и новые метки получают значения по умолчанию, сохранённый выбор не трогаем
  const s: Record<string, LabelerSettings> = { ...persisted }
  for (const l of seedLabelers) {
    const defaults: Record<string, LabelAction> = {}
    for (const lbl of l.labels) defaults[lbl.value] = lbl.defaultAction
    const cur = persisted[l.id]
    s[l.id] = cur
      ? { ...cur, actions: { ...defaults, ...cur.actions } }
      : { subscribed: l.id !== 'collegium-tone', actions: defaults }
  }
  return s
}

let caseCounter = 200

export function StoreProvider({ children }: { children: ReactNode }) {
  const [persisted, setPersisted] = useState<Persisted>(loadPersisted)

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(persisted))
    } catch {
      /* квота — игнорируем */
    }
  }, [persisted])

  // сессия закончилась (здесь или в другой вкладке) — выходим из аккаунта и в интерфейсе
  useEffect(() => {
    const ended = () => setPersisted((prev) => (prev.user ? { ...prev, user: null } : prev))
    // профиль в браузере есть, а токенов уже нет (стёрла соседняя вкладка до исправления) — тоже выход
    if (!hasSession()) ended()
    const onStorage = (e: StorageEvent) => {
      if (e.key === SESSION_STORAGE_KEY && e.newValue === null) ended()
    }
    window.addEventListener(SESSION_ENDED_EVENT, ended)
    window.addEventListener('storage', onStorage)
    return () => {
      window.removeEventListener(SESSION_ENDED_EVENT, ended)
      window.removeEventListener('storage', onStorage)
    }
  }, [])

  // применяем preferences к документу: шрифт, акцент, тема, lang
  useEffect(() => {
    const root = document.documentElement
    const { font, accent, uiLang } = persisted.prefs
    // гость — всегда как в системе: выбор темы — у вошедших (Настройки → Внешний вид)
    const appearance = persisted.user && persisted.prefs.appearanceSet ? persisted.prefs.appearance : 'system'
    root.dataset.font = font
    root.dataset.accent = accent
    root.lang = uiLang
    const mql = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = () => {
      const dark = appearance === 'dark' || (appearance === 'system' && mql.matches)
      root.classList.toggle('dark', dark)
      // BlockSuite (тема AFFiNE) переключается атрибутом data-theme
      root.dataset.theme = dark ? 'dark' : 'light'
      root.style.colorScheme = dark ? 'dark' : 'light'
    }
    apply()
    if (appearance !== 'system') return
    mql.addEventListener('change', apply)
    return () => mql.removeEventListener('change', apply)
  }, [persisted.prefs, persisted.user])

  const settings = useMemo(() => initialSettings(persisted.settings), [persisted.settings])

  // язык и валюта по региону, пока пользователь не выбрал их сам: страна регистрации, иначе по IP
  const signupCountry = persisted.user?.signupCountry
  useEffect(() => {
    if (persisted.uiLangExplicit && persisted.currencyExplicit) return
    let cancelled = false
    const apply = (country: string | undefined) => {
      if (cancelled || !country || country === 'ZZ') return
      const lang = langForCountry(country)
      const currency = currencyForCountry(country)
      setPersisted((prev) => {
        const next = { ...prev.prefs }
        if (!prev.uiLangExplicit) next.uiLang = lang
        if (!prev.currencyExplicit) next.currency = currency
        return next.uiLang === prev.prefs.uiLang && next.currency === prev.prefs.currency ? prev : { ...prev, prefs: next }
      })
    }
    if (signupCountry) apply(signupCountry)
    else api.geo().then((g) => apply(g.country), () => {})
    return () => {
      cancelled = true
    }
  }, [persisted.uiLangExplicit, persisted.currencyExplicit, signupCountry])

  // ── синхронизация настроек с AppView ──────────────────────────────────
  const lastSent = useRef<Record<string, string>>({})
  const syncDid = persisted.user?.did && hasSession() ? persisted.user.did : undefined

  // свой профиль — с сервера при открытии и при возврате на вкладку: Premium, выданный в админке,
  // и новое имя видны без повторного входа (иначе — данные, запомненные при входе)
  useEffect(() => {
    if (!syncDid) return
    const refresh = () =>
      void api.me().then(
        (u) => setPersisted((prev) => (prev.user?.did === u.did ? { ...prev, user: { ...prev.user, ...toUser(u) } } : prev)),
        () => {},
      )
    refresh()
    const onVisible = () => document.visibilityState === 'visible' && refresh()
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [syncDid])
  // статус привязан к DID: после смены аккаунта до ответа сервера — 'syncing'
  const [remote, setRemote] = useState<{ did: string; status: Exclude<SettingsSyncState, 'local'> } | null>(null)
  const settingsSync: SettingsSyncState = !syncDid ? 'local' : remote?.did === syncDid ? remote.status : 'syncing'
  const setSettingsSync = (status: Exclude<SettingsSyncState, 'local'>) => syncDid && setRemote({ did: syncDid, status })

  const localSections = useMemo<Required<ServerSettings>>(
    () => ({
      prefs: persisted.prefs,
      notificationPrefs: persisted.notificationPrefs,
      editorPrefs: persisted.editorPrefs,
      labelers: settings,
      juryOptOut: persisted.juryOptOut,
      payoutConnected: persisted.payoutConnected,
      tiers: persisted.tiers,
      blockDefs: persisted.blockDefs,
      videoProgress: persisted.videoProgress,
      readHistory: persisted.prefs.historyEnabled === false ? [] : persisted.readHistory,
      payoutDetails: {
        country: persisted.payoutCountry,
        method: persisted.payoutMethod,
        asset: persisted.payoutAsset,
        network: persisted.payoutNetwork,
        cryptoAddress: persisted.cryptoAddress,
      },
    }),
    [
      persisted.prefs, persisted.notificationPrefs, persisted.editorPrefs, settings, persisted.juryOptOut, persisted.payoutConnected, persisted.tiers, persisted.blockDefs,
      persisted.payoutCountry, persisted.payoutMethod, persisted.payoutAsset, persisted.payoutNetwork, persisted.cryptoAddress,
      persisted.videoProgress, persisted.readHistory,
    ],
  )
  const localRef = useRef(localSections)
  useEffect(() => {
    localRef.current = localSections
  }, [localSections])

  // вход: серверные разделы перекрывают локальные, отсутствующие на сервере — заливаем
  useEffect(() => {
    lastSent.current = {}
    if (!syncDid) return
    const did = syncDid
    let cancelled = false
    ;(async () => {
      const done = (status: 'saved' | 'error') => !cancelled && setRemote({ did, status })
      try {
        const { data } = await api.getSettings()
        if (cancelled) return
        const local = localRef.current
        const missing = Object.fromEntries(
          (Object.keys(local) as SettingsSection[]).filter((k) => data[k] === undefined).map((k) => [k, local[k]]),
        ) as ServerSettings
        const merged = {
          ...local,
          ...data,
          // с телефона и ноутбука: не «сервер перекрывает», а объединяем — свежее побеждает
          videoProgress: mergeProgress(local.videoProgress, data.videoProgress),
          readHistory: mergeHistory(local.readHistory, data.readHistory),
        }
        setPersisted((prev) => ({
          ...prev,
          prefs: { ...defaultPreferences, ...merged.prefs },
          notificationPrefs: merged.notificationPrefs,
          editorPrefs: { ...defaultEditorPreferences, ...merged.editorPrefs },
          settings: merged.labelers,
          juryOptOut: merged.juryOptOut,
          payoutConnected: merged.payoutConnected,
          tiers: merged.tiers,
          blockDefs: merged.blockDefs ?? [],
          videoProgress: merged.videoProgress,
          readHistory: merged.readHistory,
          ...(merged.payoutDetails
            ? {
                payoutCountry: merged.payoutDetails.country,
                payoutMethod: merged.payoutDetails.method,
                payoutAsset: merged.payoutDetails.asset,
                payoutNetwork: merged.payoutDetails.network,
                cryptoAddress: merged.payoutDetails.cryptoAddress,
              }
            : {}),
        }))
        for (const k of Object.keys(merged) as SettingsSection[]) lastSent.current[k] = JSON.stringify(merged[k])
        if (Object.keys(missing).length > 0) await api.patchSettings(missing)
        done('saved')
      } catch {
        done('error')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [syncDid])

  // изменения разделов -> PATCH только изменившихся, с debounce
  useEffect(() => {
    if (!syncDid || settingsSync === 'local' || Object.keys(lastSent.current).length === 0) return
    const changed = Object.fromEntries(
      (Object.keys(localSections) as SettingsSection[])
        .filter((k) => lastSent.current[k] !== JSON.stringify(localSections[k]))
        .map((k) => [k, localSections[k]]),
    ) as ServerSettings
    if (Object.keys(changed).length === 0) return
    const timer = window.setTimeout(() => {
      setSettingsSync('syncing')
      api.patchSettings(changed).then(
        () => {
          for (const [k, v] of Object.entries(changed)) lastSent.current[k] = JSON.stringify(v)
          setSettingsSync('saved')
        },
        () => setSettingsSync('error'),
      )
    }, 500)
    return () => window.clearTimeout(timer)
    // settingsSync не в deps: смена статуса не должна перезапускать отправку
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localSections, syncDid])

  // capabilities визуального редактора: кастомные блоки — только Premium,
  // дефолты новых callout'ов берутся из настроек «Редактор»
  useEffect(() => {
    setEditorCaps({
      premium: !!persisted.user?.premium,
      customBlocksEnabled: persisted.editorPrefs.customBlocks,
      callout: { tone: persisted.editorPrefs.calloutVariant, icon: persisted.editorPrefs.calloutIcon },
      blockDefs: persisted.user?.premium ? persisted.blockDefs : [],
      devPreview: !!persisted.prefs.devPreview,
    })
  }, [persisted.user?.premium, persisted.editorPrefs, persisted.blockDefs, persisted.prefs.devPreview])

  // статьи с PDS площадки (авторы и краулеры); обновляем раз в минуту
  const [remoteArticles, setRemoteArticles] = useState<Article[]>([])
  useEffect(() => {
    let alive = true
    // лайки читателя с сервера: кнопка и счётчик статей из индекса — по ним, а не по localStorage
    const withMyLikes = async (list: Article[]) => {
      if (!syncDid) return list
      const uris = list.flatMap((a) => (a.atUri ? [a.atUri] : []))
      const liked = new Set<string>()
      try {
        for (let i = 0; i < uris.length; i += 200) {
          for (const l of (await likes.mine(uris.slice(i, i + 200))).likes) liked.add(l.subject)
        }
      } catch {
        return list
      }
      const out = list.map((a) => ({ ...a, likedByMe: !!a.atUri && liked.has(a.atUri) }))
      const ids = new Set(out.map((a) => a.id))
      if (alive) {
        setPersisted((prev) => ({
          ...prev,
          upvotes: [...prev.upvotes.filter((id) => !ids.has(id)), ...out.filter((a) => a.likedByMe).map((a) => a.id)],
        }))
      }
      return out
    }
    const load = () =>
      fetchRemoteFeed()
        .then(withMyLikes)
        .then((a) => alive && setRemoteArticles(a), () => {})
    load()
    const t = setInterval(load, 60_000)
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [syncDid])

  const articles = useMemo(() => {
    // запись уже пришла с сервера — показываем её (правки в охлаждении, соавторы), копия в браузере нужна
    // только пока сервер её ещё не отдаёт (сразу после публикации, отложенная — для автора)
    const remote = new Set(remoteArticles.map((a) => a.atUri).filter(Boolean))
    return [...persisted.extraArticles.filter((a) => !a.atUri || !remote.has(a.atUri)), ...remoteArticles]
  }, [persisted.extraArticles, remoteArticles])

  useEffect(() => {
    if (!syncDid || articles.length === 0) return
    let alive = true
    notificationsApi.subscriptions().then(({ authors }) => {
      if (!alive) return
      const subscribed = new Set(authors)
      const handles = [...new Set(articles.filter((a) => subscribed.has(a.author.did)).map((a) => a.author.handle))]
      setPersisted((prev) => JSON.stringify(prev.authorSubscriptions) === JSON.stringify(handles) ? prev : { ...prev, authorSubscriptions: handles })
    }, () => {})
    return () => { alive = false }
  }, [syncDid, articles])

  // люди для @mention-автодополнения в редакторе: авторы записей + известные профили
  useEffect(() => {
    const byHandle = new Map<string, { name: string; handle: string }>()
    for (const a of articles) byHandle.set(a.author.handle, { name: a.author.name, handle: a.author.handle })
    for (const p of profileMetaSeed) {
      if (!byHandle.has(p.handle)) byHandle.set(p.handle, { name: p.handle, handle: p.handle })
    }
    setEditorPeople([...byHandle.values()])
  }, [articles])

  const cases = persisted.extraCases
  const collections = useMemo(
    () => persisted.extraCollections,
    [persisted.extraCollections],
  )

  const value = useMemo<StoreValue>(() => {
    const patch = (p: Partial<Persisted>) => setPersisted((prev) => ({ ...prev, ...p }))
    const user = persisted.user

    const caseStats = (c: CaseFile) => {
      const myVote = persisted.votes[c.id]
      const myWeight = user?.premium ? 1.5 : 1
      const guilty = c.baseGuilty + (myVote === 'guilty' ? myWeight : 0)
      const clear = c.baseClear + (myVote === 'clear' ? myWeight : 0)
      const voted = Math.min(c.jurorsTotal, Math.round((c.baseGuilty + c.baseClear + (myVote ? myWeight : 0)) * 10) / 10)
      const closed = c.status === 'closed' || voted >= c.quorum
      const outcome = c.outcome ?? (closed ? (guilty > clear ? 'guilty' : 'clear') : null)
      return { guilty, clear, voted, closed, outcome, myVote, myWeight }
    }

    const actionForLabel = (labelValue: string): LabelAction | null => {
      for (const l of seedLabelers) {
        if (l.labels.some((x) => x.value === labelValue)) {
          const s = settings[l.id]
          return s?.subscribed ? (s.actions[labelValue] ?? 'ignore') : null
        }
      }
      return null
    }

    return {
      ...persisted,
      settings,
      articles,
      cases,
      collections,
      isPremium: !!user?.premium,
      settingsSync,
      caseStats,
      actionForLabel,
      login: (u) => patch({ user: u ?? anonUser }),
      logout: () => {
        clearSession()
        // история и позиции — личные: на общем устройстве после выхода их не видно
        patch({ user: null, readHistory: [], videoProgress: {} })
      },
      setPremium: (v) =>
        patch({
          user: { ...(user ?? anonUser), premium: v, premiumSinceMonths: v ? 8 : 0 },
        }),
      saveAi: (key, model) => patch({ ai: { openrouterKey: key, model } }),
      toggleSubscription: (labelerId) => {
        const cur = settings[labelerId] ?? { subscribed: false, actions: {} }
        patch({ settings: { ...settings, [labelerId]: { ...cur, subscribed: !cur.subscribed } } })
      },
      setLabelAction: (labelerId, labelValue, action) => {
        const cur = settings[labelerId] ?? { subscribed: true, actions: {} }
        patch({
          settings: {
            ...settings,
            [labelerId]: { ...cur, actions: { ...cur.actions, [labelValue]: action } },
          },
        })
      },
      castVote: (caseId, vote) => patch({ votes: { ...persisted.votes, [caseId]: vote } }),
      castPollVote: (key, optionIndexes) => patch({ pollVotes: { ...persisted.pollVotes, [key]: optionIndexes } }),
      retractPollVote: (key) => {
        const rest = { ...persisted.pollVotes }
        delete rest[key]
        patch({ pollVotes: rest })
      },
      closePoll: (key) => patch({ pollClosed: { ...persisted.pollClosed, [key]: new Date().toISOString() } }),
      toggleUpvote: (articleId) => {
        const on = !persisted.upvotes.includes(articleId)
        const set = (want: boolean) =>
          setPersisted((prev) => ({
            ...prev,
            upvotes: want ? [...prev.upvotes.filter((x) => x !== articleId), articleId] : prev.upvotes.filter((x) => x !== articleId),
          }))
        set(on)
        // статья из индекса — настоящий лайк в репозитории читателя; ошибка — откатываем кнопку
        const a = articles.find((x) => x.id === articleId)
        if (a?.fromIndex && a.atUri && a.cid && hasSession()) {
          ;(on ? likes.like(a.atUri, a.cid) : likes.unlike(a.atUri)).catch(() => set(!on))
        }
      },
      syncVideoProgress: (key, t, d) =>
        setPersisted((prev) => {
          const rest = { ...prev.videoProgress }
          delete rest[key]
          if (t <= 0) return { ...prev, videoProgress: rest }
          // самые старые — вон: на сервере не больше VIDEO_PROGRESS_MAX
          const kept = Object.entries(rest).sort((a, b) => b[1].at - a[1].at).slice(0, VIDEO_PROGRESS_MAX - 1)
          return { ...prev, videoProgress: { ...Object.fromEntries(kept), [key]: { t: Math.floor(t), ...(d ? { d: Math.floor(d) } : {}), at: Date.now() } } }
        }),
      recordRead: (article) =>
        setPersisted((prev) => {
          if (prev.prefs.historyEnabled === false) return prev
          const entry: ReadEntry = {
            id: article.id,
            ...(article.atUri?.startsWith('at://did:') ? { uri: article.atUri } : {}),
            title: article.title.slice(0, 300),
            author: article.author.handle,
            kind: article.kind === 'video' ? 'video' : 'text',
            at: Date.now(),
          }
          return { ...prev, readHistory: [entry, ...prev.readHistory.filter((e) => e.id !== article.id)].slice(0, HISTORY_MAX) }
        }),
      clearHistory: () => patch({ readHistory: [] }),
      toggleBookmark: (articleId) =>
        patch({
          bookmarks: persisted.bookmarks.includes(articleId)
            ? persisted.bookmarks.filter((x) => x !== articleId)
            : [...persisted.bookmarks, articleId],
        }),
      toggleFollow: (handle) =>
        patch({
          following: persisted.following.includes(handle)
            ? persisted.following.filter((h) => h !== handle)
            : [...persisted.following, handle],
        }),
      markNotificationsRead: (ids) =>
        patch({ readNotifications: [...new Set([...persisted.readNotifications, ...ids])] }),
      setJuryOptOut: (v) => patch({ juryOptOut: v }),
      setPayoutConnected: (v) => patch({ payoutConnected: v }),
      setPayoutDetails: (p) => patch(p),
      saveTier: (t) => {
        const exists = persisted.tiers.some((x) => x.id === t.id)
        patch({
          tiers: exists
            ? persisted.tiers.map((x) => (x.id === t.id ? t : x))
            : [...persisted.tiers, t],
        })
      },
      deleteTier: (id) => patch({ tiers: persisted.tiers.filter((x) => x.id !== id) }),
      addReport: (r) => {
        const report: Report = {
          ...r,
          id: `rep-${Date.now()}`,
          status: 'pending',
          createdAt: new Date().toISOString(),
        }
        patch({ reports: [report, ...persisted.reports] })
        return report
      },
      addSupportTicket: async (t) => {
        const { status: _local, ...body } = t
        void _local
        const saved = await supportApi.create(body)
        const ticket: SupportTicket = { ...t, id: saved.id, status: t.status ?? 'received', createdAt: saved.createdAt }
        setPersisted((prev) => ({ ...prev, supportTickets: [ticket, ...prev.supportTickets] }))
        return ticket
      },
      setPrefs: (p) =>
        patch({
          prefs: { ...persisted.prefs, ...p },
          ...(p.uiLang !== undefined ? { uiLangExplicit: true } : {}),
          ...(p.currency !== undefined ? { currencyExplicit: true } : {}),
        }),
      setNotificationPrefs: (p) => patch({ notificationPrefs: { ...persisted.notificationPrefs, ...p } }),
      setEditorPrefs: (p) => patch({ editorPrefs: { ...persisted.editorPrefs, ...p } }),
      setBlockDefs: (defs) => patch({ blockDefs: defs }),
      unlock: (articleId) => patch({ unlocked: { ...persisted.unlocked, [articleId]: true } }),
      publishArticle: async (article, text, draftId) => {
        const now = new Date().toISOString()
        const video = article.kind === 'video'
        // видео-ссылка; пустая — демо-ролик площадки (DEMO_VIDEO на странице статьи)
        const clip: RecordVideo | null = video
          ? article.videoSource === 'file'
            ? null
            : videoFromLink(article.videoUrl || `${window.location.origin}/demo-video.mp4`)
          : null
        // с аккаунтом — всегда в сеть (отложенный пост тоже: сервер выпустит его в срок); раньше отложенные,
        // платные и с видеофайлом молча оставались только в этом браузере
        // без входа публиковать некуда: раньше статья молча оставалась только в этом браузере
        if (text !== undefined && !hasSession()) throw new Error('Вы не вошли — статья не опубликована. Войдите и нажмите «Опубликовать» ещё раз: черновик сохранится.')
        if (text !== undefined && hasSession() && article.paywall) throw new Error('Платные статьи пока не публикуются в сеть — уберите платный доступ или сохраните черновик')
        if (text !== undefined && hasSession() && video && !clip) throw new Error('Видео файлом пока не публикуется в сеть — вставьте ссылку на ролик (YouTube, Loom или https://…)')
        const toPds = text !== undefined && hasSession() && (!video || !!clip)
        let remote: { uri: string; cid: string; pendingUntil?: string } | null = null
        if (toPds) {
          remote = await articlesApi.publish({
            title: article.title,
            ...(article.subtitle ? { subtitle: article.subtitle } : {}),
            text,
            ...(article.excerpt ? { excerpt: article.excerpt.slice(0, 500) } : {}),
            tags: article.tags,
            langs: article.language ? [article.language] : [],
            kind: video ? 'video' : 'text',
            ...(article.noindex ? { noindex: true } : {}),
            ...(draftId ? { draftId } : {}),
            ...(article.republished ? { republished: { url: article.republished.url, ...(article.republished.publishedAt ? { publishedAt: article.republished.publishedAt } : {}) } } : {}),
            ...(article.publishAt && article.publishAt > now ? { publishAt: new Date(article.publishAt).toISOString() } : {}),
            videos: clip
              ? [
                  {
                    ...clip,
                    title: article.title,
                    ...(article.videoDescription ? { description: article.videoDescription } : {}),
                    ...(article.videoPreviewRange ? { preview: article.videoPreviewRange } : {}),
                  },
                ]
              : [],
          })
        }
        const publishedId = remote ? remoteId(remote.uri) : article.id
        setPersisted((prev) => ({
          ...prev,
          extraCollections: article.collectionId
            ? prev.extraCollections.map((collection) =>
                collection.id === article.collectionId && !collection.articleIds.includes(publishedId)
                  ? { ...collection, articleIds: [...collection.articleIds, publishedId] }
                  : collection,
              )
            : prev.extraCollections,
          extraArticles: [
            {
              ...article,
              // настоящий адрес записи (в охлаждении CID ещё нет — запись не в репозитории); без сети — ни того, ни другого.
              // id — сетевой (как у ленты): страница статьи сразу после публикации открывается по нему, без 404
              ...(remote ? { id: remoteId(remote.uri) } : {}),
              ...(remote ? { atUri: remote.uri, cid: remote.cid || undefined, fromIndex: true, likeCount: 0, commentCount: 0, ...(remote.pendingUntil ? { pendingUntil: remote.pendingUntil } : {}) } : {}),
              originPds: article.originPds ?? PDS_URL,
              indexedAt: article.indexedAt ?? new Date().toISOString(),
              // полное время: по нему сортируют «Свежее» и «Горячее» (одна дата ставила запись в полночь)
              publishedAtFull: article.publishedAtFull ?? article.publishAt ?? new Date().toISOString(),
              sourceType: article.sourceType ?? 'native-pds',
              ...(remote?.uri ?? article.canonicalId ? { canonicalId: remote?.uri ?? article.canonicalId } : {}),
            },
            ...prev.extraArticles,
          ],
        }))
        return remote?.uri
      },
      forgetArticle: (atUri) => setPersisted((prev) => ({ ...prev, extraArticles: prev.extraArticles.filter((a) => a.atUri !== atUri) })),
      addComment: async (articleId, text, parentId) => {
        const a = articles.find((x) => x.id === articleId)
        const comment: Comment =
          a?.fromIndex && a.atUri && hasSession()
            ? // ответ на демо-комментарий (не AT URI) уходит как комментарий к статье
              toComment(await comments.create({ subject: a.atUri, text, ...(parentId?.startsWith('at://') ? { parent: parentId } : {}) }))
            : {
                id: `u-${Date.now()}`,
                author: user?.handle ?? 'anon',
                text,
                at: new Date().toISOString().slice(0, 16).replace('T', ' '),
                ...(parentId ? { parentId } : {}),
              }
        // после await состояние могло поменяться — обновляем от актуального
        setPersisted((prev) => ({
          ...prev,
          extraComments: { ...prev.extraComments, [articleId]: [...(prev.extraComments[articleId] ?? []), comment] },
          // автор комментария автоматически следит за ответами в треде
          watchedArticles: prev.watchedArticles.includes(articleId) ? prev.watchedArticles : [...prev.watchedArticles, articleId],
        }))
      },
      deleteComment: async (articleId, commentId) => {
        if (commentId.startsWith('at://')) await comments.remove(commentId.split('/').pop()!)
        setPersisted((prev) => ({
          ...prev,
          extraComments: { ...prev.extraComments, [articleId]: (prev.extraComments[articleId] ?? []).filter((c) => c.id !== commentId) },
        }))
      },
      toggleAuthorSubscription: (handle) => {
        const subscribed = persisted.authorSubscriptions.includes(handle)
        patch({ authorSubscriptions: subscribed ? persisted.authorSubscriptions.filter((h) => h !== handle) : [...persisted.authorSubscriptions, handle] })
        const author = articles.find((a) => a.author.handle === handle)?.author
        if (author && hasSession()) {
          ;(subscribed ? notificationsApi.unsubscribe(author.did) : notificationsApi.subscribe(author.did)).catch(() =>
            patch({ authorSubscriptions: subscribed ? [...persisted.authorSubscriptions, handle] : persisted.authorSubscriptions.filter((h) => h !== handle) }),
          )
        }
      },
      toggleWatchArticle: (articleId) =>
        patch({
          watchedArticles: persisted.watchedArticles.includes(articleId)
            ? persisted.watchedArticles.filter((x) => x !== articleId)
            : [...persisted.watchedArticles, articleId],
        }),
      createCollection: (title, description) => {
        const col: Collection = {
          id: `u-col-${Date.now()}`,
          title,
          description,
          authorHandle: user?.handle ?? 'you',
          articleIds: [],
        }
        patch({ extraCollections: [col, ...persisted.extraCollections] })
        return col
      },
      addToCollection: (collectionId, articleId) => {
        const all = persisted.extraCollections
        const target = all.find((c) => c.id === collectionId)
        if (!target || target.articleIds.includes(articleId)) return
        const updated = { ...target, articleIds: [...target.articleIds, articleId] }
        if (persisted.extraCollections.some((c) => c.id === collectionId)) {
          patch({
            extraCollections: persisted.extraCollections.map((c) => (c.id === collectionId ? updated : c)),
          })
        } else {
          // клонируем seed-подборку в пользовательские при изменении
          patch({ extraCollections: [updated, ...persisted.extraCollections] })
        }
      },
      reportToCourt: (articleId, { collegiumId, labelValue, charges }) => {
        const article = articles.find((a) => a.id === articleId)
        const collegium = seedLabelers.find((l) => l.id === collegiumId)
        if (!collegium || !collegium.labels.some((l) => l.value === labelValue)) {
          throw new Error('Выберите коллегию и нарушение.')
        }
        // доменное правило: свою статью нельзя вынести на суд
        if (user && article && article.author.handle === user.handle) {
          throw new Error('Свою статью нельзя вынести на суд.')
        }
        const id = `u-case-${Date.now()}`
        const newCase: CaseFile = {
          id,
          number: `ДЕЛО №2026-${++caseCounter}`,
          articleId,
          articleTitle: article?.title ?? '—',
          charges,
          collegiumId,
          labelValue,
          openedAt: new Date().toISOString().slice(0, 10),
          quorum: 5,
          jurorsTotal: 7,
          baseGuilty: 0,
          baseClear: 0,
          status: 'open',
        }
        patch({ extraCases: [newCase, ...persisted.extraCases] })
        return id
      },
      transferRights: (articleId) => {
        if (!user) return
        // переоформляем статью: автором становится текущий пользователь, пометка источника снимается
        setPersisted((prev) => {
          const original = articles.find((a) => a.id === articleId)
          if (!original) return prev
          if (!original.source) return prev
          const transferred: Article = {
            ...original,
            author: { name: user.name, handle: user.handle, did: user.did },
            source: undefined,
          }
          const rest = prev.extraArticles.filter((a) => a.id !== articleId)
          return { ...prev, extraArticles: [transferred, ...rest] }
        })
      },
      shareDraft: (article) => {
        const token = `t-${Math.random().toString(36).slice(2, 10)}`
        patch({
          sharedDrafts: {
            ...persisted.sharedDrafts,
            [token]: { article, createdAt: new Date().toISOString() },
          },
        })
        return token
      },
    }
  }, [persisted, settings, articles, cases, collections, settingsSync])

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>
}

export function useStore(): StoreValue {
  const ctx = useContext(StoreContext)
  if (!ctx) throw new Error('useStore вне StoreProvider')
  return ctx
}
