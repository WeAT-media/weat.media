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
} from '@/types/types'
import { defaultEditorPreferences, defaultPreferences } from '@/types/types'
import {
  articles as seedArticles,
  cases as seedCases,
  collectionsSeed,
  currentUser as anonUser,
  labelers as seedLabelers,
} from '@/data/mock'

import type { BlockDef } from '@/lib/userBlocks'
import { currencyForCountry } from '@/lib/money'
import { api, clearSession, comments, hasSession, likes, type ServerSettings } from '@/lib/api'

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
import { fetchRemoteFeed, toComment } from '@/lib/remoteFeed'

const STORAGE_KEY = 'indie-media:v1'

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
  prefs: Preferences
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
  toggleFollow: (handle: string) => void
  markNotificationsRead: (ids: string[]) => void
  setJuryOptOut: (v: boolean) => void
  setPayoutConnected: (v: boolean) => void
  /** сохранить параметры выплат (страна, метод, актив/сеть/адрес) без потери остального */
  setPayoutDetails: (patch: Partial<Pick<Persisted, 'payoutCountry' | 'payoutMethod' | 'payoutAsset' | 'payoutNetwork' | 'cryptoAddress'>>) => void
  saveTier: (t: SubscriptionTier) => void
  deleteTier: (id: string) => void
  addReport: (r: Omit<Report, 'id' | 'createdAt' | 'status'>) => Report
  addSupportTicket: (t: Omit<SupportTicket, 'id' | 'createdAt' | 'status'> & { status?: SupportTicket['status'] }) => SupportTicket
  setPrefs: (patch: Partial<Preferences>) => void
  setEditorPrefs: (patch: Partial<EditorPreferences>) => void
  setBlockDefs: (defs: BlockDef[]) => void
  publishArticle: (article: Article) => void
  /** у статьи из индекса — запись в репозиторий читателя; ошибка API пробрасывается (ApiError) */
  addComment: (articleId: string, text: string, parentId?: string) => Promise<void>
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
    editorPrefs: defaultEditorPreferences,
    blockDefs: [],
    ai: { openrouterKey: '', model: 'openrouter/free' },
  }
  try {
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

  // применяем preferences к документу: шрифт, акцент, тема, lang
  useEffect(() => {
    const root = document.documentElement
    const { font, accent, appearance, uiLang } = persisted.prefs
    root.dataset.font = font
    root.dataset.accent = accent
    root.lang = uiLang
    const mql = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = () =>
      root.classList.toggle('dark', appearance === 'dark' || (appearance === 'system' && mql.matches))
    apply()
    if (appearance !== 'system') return
    mql.addEventListener('change', apply)
    return () => mql.removeEventListener('change', apply)
  }, [persisted.prefs])

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
  // статус привязан к DID: после смены аккаунта до ответа сервера — 'syncing'
  const [remote, setRemote] = useState<{ did: string; status: Exclude<SettingsSyncState, 'local'> } | null>(null)
  const settingsSync: SettingsSyncState = !syncDid ? 'local' : remote?.did === syncDid ? remote.status : 'syncing'
  const setSettingsSync = (status: Exclude<SettingsSyncState, 'local'>) => syncDid && setRemote({ did: syncDid, status })

  const localSections = useMemo<Required<ServerSettings>>(
    () => ({
      prefs: persisted.prefs,
      editorPrefs: persisted.editorPrefs,
      labelers: settings,
      juryOptOut: persisted.juryOptOut,
      payoutConnected: persisted.payoutConnected,
      tiers: persisted.tiers,
      blockDefs: persisted.blockDefs,
      payoutDetails: {
        country: persisted.payoutCountry,
        method: persisted.payoutMethod,
        asset: persisted.payoutAsset,
        network: persisted.payoutNetwork,
        cryptoAddress: persisted.cryptoAddress,
      },
    }),
    [
      persisted.prefs, persisted.editorPrefs, settings, persisted.juryOptOut, persisted.payoutConnected, persisted.tiers, persisted.blockDefs,
      persisted.payoutCountry, persisted.payoutMethod, persisted.payoutAsset, persisted.payoutNetwork, persisted.cryptoAddress,
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
        const merged = { ...local, ...data }
        setPersisted((prev) => ({
          ...prev,
          prefs: { ...defaultPreferences, ...merged.prefs },
          editorPrefs: { ...defaultEditorPreferences, ...merged.editorPrefs },
          settings: merged.labelers,
          juryOptOut: merged.juryOptOut,
          payoutConnected: merged.payoutConnected,
          tiers: merged.tiers,
          blockDefs: merged.blockDefs ?? [],
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
    // своя только что опубликованная запись уже есть локально — не дублируем
    const local = new Set(persisted.extraArticles.map((a) => a.atUri).filter(Boolean))
    return [...persisted.extraArticles, ...remoteArticles.filter((a) => !local.has(a.atUri)), ...seedArticles]
  }, [persisted.extraArticles, remoteArticles])
  // люди для @mention-автодополнения в редакторе: авторы записей + известные профили
  useEffect(() => {
    const byHandle = new Map<string, { name: string; handle: string }>()
    for (const a of articles) byHandle.set(a.author.handle, { name: a.author.name, handle: a.author.handle })
    for (const p of profileMetaSeed) {
      if (!byHandle.has(p.handle)) byHandle.set(p.handle, { name: p.handle, handle: p.handle })
    }
    setEditorPeople([...byHandle.values()])
  }, [articles])

  const cases = useMemo(() => [...persisted.extraCases, ...seedCases], [persisted.extraCases])
  const collections = useMemo(
    () => [...persisted.extraCollections, ...collectionsSeed],
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
        patch({ user: null })
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
      addSupportTicket: (t) => {
        const ticket: SupportTicket = {
          ...t,
          id: `IM-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
          status: t.status ?? 'received-demo',
          createdAt: new Date().toISOString(),
        }
        patch({ supportTickets: [ticket, ...persisted.supportTickets] })
        return ticket
      },
      setPrefs: (p) =>
        patch({
          prefs: { ...persisted.prefs, ...p },
          ...(p.uiLang !== undefined ? { uiLangExplicit: true } : {}),
          ...(p.currency !== undefined ? { currencyExplicit: true } : {}),
        }),
      setEditorPrefs: (p) => patch({ editorPrefs: { ...persisted.editorPrefs, ...p } }),
      setBlockDefs: (defs) => patch({ blockDefs: defs }),
      unlock: (articleId) => patch({ unlocked: { ...persisted.unlocked, [articleId]: true } }),
      publishArticle: (article) =>
        patch({
          extraArticles: [
            {
              ...article,
              // локальный демо-AT URI и canonicalId для новой записи
              atUri: article.atUri ?? `at://${user?.did ?? 'did:plc:reader001'}/media.weat.article/${article.id}`,
              cid: article.cid ?? `bafy…demo…${article.id}`,
              originPds: article.originPds ?? PDS_URL,
              indexedAt: article.indexedAt ?? new Date().toISOString(),
              sourceType: article.sourceType ?? 'native-pds',
              canonicalId: article.canonicalId ?? `at://${user?.did ?? 'did:plc:reader001'}/media.weat.article/${article.id}`,
            },
            ...persisted.extraArticles,
          ],
        }),
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
      toggleAuthorSubscription: (handle) =>
        patch({
          authorSubscriptions: persisted.authorSubscriptions.includes(handle)
            ? persisted.authorSubscriptions.filter((h) => h !== handle)
            : [...persisted.authorSubscriptions, handle],
        }),
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
        const all = [...persisted.extraCollections, ...collectionsSeed]
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
          const idx = seedArticles.findIndex((a) => a.id === articleId)
          if (idx < 0) return prev
          const original = seedArticles[idx]
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
