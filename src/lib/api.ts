import { firstTouchUtm, lastTouchUtm } from '@/lib/utm'
import type { BlockDef } from '@/lib/userBlocks'
import type { Collection, EditorPreferences, LabelerSettings, Preferences, SubscriptionTier, User, ReadEntry, VideoProgressEntry } from '@/types/types'

/** Ответы AppView (server/src/app.ts) */
import type { RecordVideo } from '@/lib/videoLink'
import type { DeviceSession } from '@/components/DevicesList'

export interface ApiUser {
  /** только в публичном профиле: число платных подписчиков */
  paidSubscribers?: number
  did: string
  handle: string
  displayName: string | null
  /** CID фото профиля (blob на PDS) — адрес картинки: avatarUrl(did, cid) */
  avatar?: string | null
  tier: 'free' | 'premium'
  premiumSince: string | null
  createdAt: string
  /** только свой профиль (сессия, /me): регистрации — неизменна, резидентства — меняется по заявке */
  signupCountry?: string
  residenceCountry?: string
}

export interface GeoInfo {
  country: string
  contour: 'global' | 'ru'
  allowed: boolean
  /** внешние провайдеры, которыми можно войти с этой страницы (с учётом контура) */
  providers: Provider[]
  /** коллегии, которых в этом контуре нет (РФ: nsfw, politics — их записи закрыты сервером) */
  hiddenCollegia?: string[]
}

export type Provider = 'yandex' | 'google' | 'github' | 'telegram' | 'atproto'
export type OAuthProvider = Exclude<Provider, 'atproto'>

export interface IdentitiesView {
  /** пользователь знает пароль: регистрация по email */
  passwordLogin: boolean
  providers: {
    provider: Provider
    origin: 'ru' | 'foreign'
    configured: boolean
    /** можно ли входить через сервис; привязать можно всегда (149-ФЗ) */
    loginAllowed: boolean
    linked: { display: string | null; linkedAt: string; primary: boolean } | null
  }[]
}

export const PROVIDER_LABEL: Record<Provider, string> = {
  yandex: 'Яндекс ID',
  google: 'Google',
  github: 'GitHub',
  telegram: 'Telegram',
  atproto: 'AT Protocol',
}

interface SessionResponse {
  accessJwt: string
  refreshJwt: string
  user: ApiUser
}

export class ApiError extends Error {
  readonly status: number
  readonly code: string
  /** остальные поля ответа (например, redirect у WrongContour) */
  readonly data: Record<string, unknown>
  constructor(status: number, code: string, message: string, data: Record<string, unknown> = {}) {
    super(message)
    this.status = status
    this.code = code
    this.data = data
  }
}

export const SESSION_STORAGE_KEY = 'indie-media:session'
const SESSION_KEY = SESSION_STORAGE_KEY
const BASE = import.meta.env.VITE_API_URL ?? '/api'

interface Tokens {
  accessJwt: string
  refreshJwt: string
}

// копия в памяти: в приватном режиме localStorage может бросать
let memTokens: Tokens | null = null

function saveSession(s: Tokens) {
  memTokens = { accessJwt: s.accessJwt, refreshJwt: s.refreshJwt }
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(memTokens))
  } catch {
    /* сессия живёт до перезагрузки */
  }
}

/**
 * Всегда из localStorage: другая вкладка могла обновить сессию (PDS при обновлении выдаёт новый refresh-токен,
 * старый перестаёт работать) — копия в памяти устаревала, её refresh отклонялся, и вкладка стирала сессию
 * целиком, вместе со свежими токенами соседней. Память — только если localStorage недоступен.
 */
function loadSession(): Tokens | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY)
    memTokens = raw ? (JSON.parse(raw) as Tokens) : null
  } catch {
    /* приватный режим — живём с копией в памяти */
  }
  return memTokens
}

/** сессия закончилась (refresh отклонён) — интерфейс выходит из аккаунта, а не показывает «призрачный» профиль */
export const SESSION_ENDED_EVENT = 'weat:session-ended'

export function hasSession(): boolean {
  return loadSession() !== null
}

export function clearSession() {
  memTokens = null
  try {
    localStorage.removeItem(SESSION_KEY)
  } catch {
    /* noop */
  }
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${BASE}${path}`, {
      ...init,
      headers: { 'content-type': 'application/json', ...init.headers },
    })
  } catch {
    throw new ApiError(0, 'NetworkError', 'Сервер недоступен. Проверьте подключение.')
  }
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new ApiError(res.status, data.error ?? 'Error', data.message ?? res.statusText, data)
  return data as T
}

let refreshing: Promise<void> | null = null

/**
 * Продление заранее: access-токен PDS живёт ~2 ч. Раньше он обновлялся только после отказа сервера — запрос
 * мог потеряться (автосохранение, публикация). Теперь — за 5 минут до истечения, раз в минуту проверяем,
 * и сразу при возврате на вкладку (таймеры в фоне браузер замедляет).
 */
const jwtExp = (jwt: string): number | null => {
  try {
    const p = JSON.parse(atob(jwt.split('.')[1]!.replace(/-/g, '+').replace(/_/g, '/'))) as { exp?: number }
    return typeof p.exp === 'number' ? p.exp * 1000 : null
  } catch {
    return null
  }
}

export async function refreshIfExpiring(marginMs = 5 * 60_000): Promise<void> {
  const t = loadSession()
  if (!t) return
  const exp = jwtExp(t.accessJwt)
  if (exp === null || exp - Date.now() > marginMs) return
  refreshing ??= refreshShared(t.refreshJwt).finally(() => {
    refreshing = null
  })
  await refreshing.catch(() => {})
}

if (typeof window !== 'undefined') {
  window.setInterval(() => void refreshIfExpiring(), 60_000)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void refreshIfExpiring()
  })
}

async function refreshShared(staleRefresh: string): Promise<void> {
  const run = async () => {
    // пока ждали блокировку, соседняя вкладка могла уже обновить — берём её токены
    const now = loadSession()
    if (now && now.refreshJwt !== staleRefresh) return
    try {
      saveSession(await call<SessionResponse>('/auth/refresh', { method: 'POST', body: JSON.stringify({ refreshJwt: staleRefresh }) }))
    } catch (e) {
      // гонка без поддержки locks: токены успели обновиться — не стираем их
      const after = loadSession()
      if (after && after.refreshJwt !== staleRefresh) return
      // сеть пропала — сессию не трогаем, повторим позже
      if (e instanceof ApiError && e.status === 0) throw e
      clearSession()
      window.dispatchEvent(new Event(SESSION_ENDED_EVENT))
      throw e
    }
  }
  const locks = (navigator as Navigator & { locks?: { request(name: string, cb: () => Promise<void>): Promise<void> } }).locks
  return locks ? locks.request('weat-session-refresh', run) : run()
}

/** Запрос от имени пользователя; при истёкшем access-токене один раз обновляет сессию */
async function authed<T>(path: string, init: RequestInit = {}): Promise<T> {
  // истекает через минуту-другую — обновим до запроса, а не после отказа
  await refreshIfExpiring(60_000)
  const tokens = loadSession()
  if (!tokens) throw new ApiError(401, 'AuthenticationRequired', 'Нужно войти')
  const withAuth = (t: Tokens) => ({ ...init, headers: { ...init.headers, authorization: `Bearer ${t.accessJwt}` } })
  try {
    return await call<T>(path, withAuth(tokens))
  } catch (err) {
    if (!(err instanceof ApiError) || err.status !== 401) throw err
    // параллельные запросы ждут одно обновление; между вкладками — общая блокировка
    refreshing ??= refreshShared(tokens.refreshJwt).finally(() => {
      refreshing = null
    })
    await refreshing
    return call<T>(path, withAuth(loadSession()!))
  }
}

export function monthsSince(iso: string | null): number {
  if (!iso) return 0
  const d = new Date(iso)
  const now = new Date()
  return Math.max(0, (now.getFullYear() - d.getFullYear()) * 12 + now.getMonth() - d.getMonth())
}

export function toUser(u: ApiUser): User {
  return {
    name: u.displayName ?? u.handle.split('.')[0] ?? u.handle,
    handle: u.handle,
    did: u.did,
    premium: u.tier === 'premium',
    premiumSinceMonths: monthsSince(u.premiumSince),
    createdAt: u.createdAt,
    signupCountry: u.signupCountry,
    residenceCountry: u.residenceCountry ?? u.signupCountry,
  }
}

export interface NotificationPreferences {
  articles: boolean
  comments: boolean
  replies: boolean
}

export interface AppNotification {
  id: string
  kind: 'article' | 'comment' | 'reply'
  actorDid: string
  actorHandle: string
  subjectUri: string
  articleUri: string
  articleTitle: string
  createdAt: string
  readAt: string | null
}

export const notifications = {
  list: () => authed<{ notifications: AppNotification[] }>('/me/notifications'),
  markRead: (ids: string[]) => authed<{ ok: true }>('/me/notifications/read', post({ ids })),
  markAllRead: () => authed<{ ok: true }>('/me/notifications/read-all', post({})),
  subscriptions: () => authed<{ authors: string[] }>('/me/author-subscriptions'),
  subscribe: (authorDid: string) => authed<{ ok: true }>(`/me/author-subscriptions/${encodeURIComponent(authorDid)}`, { method: 'PUT' }),
  unsubscribe: (authorDid: string) => authed<{ ok: true }>(`/me/author-subscriptions/${encodeURIComponent(authorDid)}`, { method: 'DELETE' }),
}

/** Серверные настройки пользователя: каждый раздел заменяется целиком */
export interface ServerSettings {
  prefs?: Preferences
  notificationPrefs?: NotificationPreferences
  editorPrefs?: EditorPreferences
  labelers?: Record<string, LabelerSettings>
  juryOptOut?: boolean
  payoutConnected?: boolean
  tiers?: SubscriptionTier[]
  blockDefs?: BlockDef[]
  payoutDetails?: { country: string; method: 'fiat' | 'crypto'; asset: string; network: string; cryptoAddress: string }
  videoProgress?: Record<string, VideoProgressEntry>
  readHistory?: ReadEntry[]
}

/** consent — как у oauthStartUrl: первый вход через AT-сервер создаёт аккаунт (глобальный контур) */
export function atprotoStartUrl(handle: string, returnTo: string, consent = false): string {
  const q = new URLSearchParams({ handle, returnTo })
  if (consent) q.set('consent', '1')
  const utm = firstTouchUtm()
  if (utm) for (const [k, v] of Object.entries(utm)) if (v) q.set(`utm_${k}`, v)
  return `${BASE}/auth/atproto/start?${q}`
}

/** consent — отметка согласия на ПДн: нужна, если через провайдера создаётся новый аккаунт */
export function oauthStartUrl(provider: OAuthProvider, returnTo: string, consent = false): string {
  const utm = firstTouchUtm()
  const q = new URLSearchParams({ returnTo })
  if (consent) q.set('consent', '1')
  if (utm) for (const [k, v] of Object.entries(utm)) if (v) q.set(`utm_${k}`, v)
  return `${BASE}/auth/${provider}/start?${q}`
}

/** Вход: либо сразу пользователь, либо нужен код из приложения-аутентификатора */
export type LoginResult = { kind: 'ok'; user: User } | { kind: 'totp'; mfaToken: string }

type GatedResponse = SessionResponse | { mfaRequired: 'totp'; mfaToken: string }

function finish(r: GatedResponse): LoginResult {
  if ('mfaRequired' in r) return { kind: 'totp', mfaToken: r.mfaToken }
  saveSession(r)
  return { kind: 'ok', user: toUser(r.user) }
}

export interface SecurityView {
  email: string | null
  emailConfirmed: boolean
  emailAuthFactor: boolean
  passwordLogin: boolean
  totpEnabled: boolean
  backupCodesLeft: number
}

const post = (body: unknown): RequestInit => ({ method: 'POST', body: JSON.stringify(body) })

export const security = {
  get: () => authed<SecurityView>('/me/security'),
  requestPasswordCode: () => authed<{ codeSent: true }>('/me/password/email/request', post({})),
  changePassword: (method: 'email' | 'totp', code: string, password: string) => authed<{ ok: true }>('/me/password/change', post({ method, code, password })),
  requestEmailConfirmation: () => authed<{ ok: true }>('/me/email/confirm/request', post({})),
  confirmEmail: (code: string) => authed<SecurityView>('/me/email/confirm', post({ code })),
  /** выключение: первый вызов без кода шлёт письмо и возвращает { codeSent } */
  setEmail2fa: (enabled: boolean, code?: string) =>
    authed<SecurityView | { codeSent: true }>('/me/2fa/email', post({ enabled, code })),
  totpSetup: () => authed<{ secret: string; otpauthUrl: string }>('/me/2fa/totp/setup', post({})),
  // refreshJwt — чтобы текущая сессия пережила включение TOTP (сервер отмечает её как прошедшую 2FA)
  totpEnable: (code: string, password: string, authFactorToken?: string) =>
    authed<{ backupCodes: string[]; security: SecurityView }>('/me/2fa/totp/enable', post({ code, password, authFactorToken, refreshJwt: loadSession()?.refreshJwt })),
  totpDisable: (code: string) => authed<SecurityView>('/me/2fa/totp/disable', post({ code })),
  regenerateBackupCodes: (code: string) => authed<{ backupCodes: string[] }>('/me/2fa/backup-codes', post({ code })),
  /** журнал устройств: свои сессии, завершить одну или все, кроме этой */
  sessions: () => authed<DeviceSession[]>('/me/sessions'),
  revokeSession: (id: string) => authed<{ ok: true }>(`/me/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  revokeOtherSessions: () => authed<{ ok: true; revoked: number }>('/me/sessions/revoke-others', post({})),
  forgotPassword: (email: string) => call<{ ok: true }>('/auth/password/forgot', post({ email })),
  resetPassword: (token: string, password: string) => call<{ ok: true }>('/auth/password/reset', post({ token, password })),
}

export type TokenScope = 'articles:write' | 'articles:delete' | 'comments:read' | 'comments:write' | 'profile:read' | 'profile:update'

export interface PersonalToken {
  id: string
  name: string
  scopes: TokenScope[]
  createdAt: string
  expiresAt: string | null
  lastUsedAt: string | null
}

export interface OAuthApp {
  clientId: string
  name: string
  homepageUrl: string
  redirectUris: string[]
  createdAt: string
  secretRotatedAt: string
}

/** Разработчикам: персональные токены и OAuth-приложения; секреты приходят один раз */
export const developer = {
  tokens: () => authed<PersonalToken[]>('/me/tokens'),
  createToken: (b: { name: string; scopes: TokenScope[]; expiresInDays: number | null }) =>
    authed<PersonalToken & { token: string }>('/me/tokens', post(b)),
  revokeToken: (id: string) => authed<{ ok: true }>(`/me/tokens/${id}`, { method: 'DELETE' }),
  /** новое значение того же токена; старое перестаёт работать сразу */
  rotateToken: (id: string) => authed<PersonalToken & { token: string }>(`/me/tokens/${id}/rotate`, post({})),
  apps: () => authed<OAuthApp[]>('/me/oauth-apps'),
  createApp: (b: { name: string; homepageUrl: string; redirectUris: string[] }) =>
    authed<OAuthApp & { clientSecret: string }>('/me/oauth-apps', post(b)),
  rotateSecret: (id: string) => authed<OAuthApp & { clientSecret: string }>(`/me/oauth-apps/${id}/secret`, post({})),
  deleteApp: (id: string) => authed<{ ok: true }>(`/me/oauth-apps/${id}`, { method: 'DELETE' }),
}

export interface LikeRef {
  subject: string
  uri: string
}

/** Лайки статей из индекса: запись media.weat.like в репозитории читателя */
export const likes = {
  /** какие из статей лайкнуты; subjects — до 200 AT URI */
  mine: (subjects: string[]) => authed<{ likes: LikeRef[] }>(`/me/likes?${new URLSearchParams({ subjects: subjects.join(',') })}`),
  like: (subject: string, cid: string) => authed<LikeRef>('/me/likes', post({ subject, cid })),
  unlike: (subject: string) => authed<{ ok: true; removed: number }>(`/me/likes?${new URLSearchParams({ subject })}`, { method: 'DELETE' }),
}

/** Публикация с сайта: запись media.weat.article в репозиторий автора (платные — /me/articles/paid) */
export const articles = {
  publish: (b: {
    title: string
    subtitle?: string
    text: string
    excerpt?: string
    tags: string[]
    langs: string[]
    kind: 'text' | 'video'
    videos: RecordVideo[]
    noindex?: boolean
    /** черновик-источник: сервер добавит в запись его рецензентов */
    draftId?: string
    publishAt?: string
    /** перепечатка: оригинал и дата первой публикации (YYYY-MM-DD или ISO) */
    republished?: { url: string; publishedAt?: string }
    /** копия в standard.site (site.standard.document); по умолчанию — да */
    standardSite?: boolean
  }) => authed<{ uri: string; cid: string; pendingUntil?: string; visibleAt?: string }>('/me/articles', post(b)),
  /** копия старой статьи в standard.site: только для уже записанных в PDS */
  standardSiteStatus: (rkey: string) => authed<{ inPds: boolean; eligible: boolean; mirrored: boolean }>(`/me/articles/${encodeURIComponent(rkey)}/standard-site`),
  mirrorToStandardSite: (rkey: string) => authed<{ uri: string }>(`/me/articles/${encodeURIComponent(rkey)}/standard-site`, { method: 'POST' }),
}

/** Черновик из импорта постов AT-аккаунта: text — markdown для редактора */
export interface ImportDraft {
  id: string
  sourceUri: string
  sourceCreatedAt: string
  title: string
  text: string
  status: 'pending' | 'published' | 'dismissed'
  articleUri: string | null
}

/** Выплаты автору: суммы — в минимальных единицах валюты (копейки, центы) */
export interface Earnings {
  holdDays: number
  balances: { currency: 'RUB' | 'USD' | 'EUR'; earned: number; pending: number; reserved: number; paidOut: number; available: number; minPayout: number }[]
  sales: { orderId: string; title: string; amount: number; authorShare: number; currency: 'RUB' | 'USD' | 'EUR'; paidAt: string }[]
  payouts: { id: string; amount: number; currency: 'RUB' | 'USD' | 'EUR'; method: 'fiat' | 'crypto'; destinationHint: string; status: 'requested' | 'paid' | 'rejected'; staffNote: string | null; createdAt: string; decidedAt: string | null }[]
}

export const payouts = {
  earnings: () => authed<Earnings>('/me/earnings'),
  request: (b: { currency: 'RUB' | 'USD' | 'EUR'; method: 'fiat' | 'crypto'; destination: string }) => authed<Earnings['payouts'][number]>('/me/payouts', post(b)),
}

/** картинка аватара: blob в репозитории пользователя на PDS */
/** фото автора — с его собственного PDS (AppView находит его по DID): автор может быть из другого контура */
export const avatarUrl = (did: string, cid: string) => `/api/blob/${encodeURIComponent(did)}/${encodeURIComponent(cid)}`

export interface ProfileView {
  did: string
  displayName: string | null
  description: string | null
  avatar: string | null
}

/** имя, «О себе», фото — запись app.bsky.actor.profile (видна и в Bluesky) */
export const handles = {
  check: (name: string) => call<{ available: boolean; suggestion?: string | null }>(`/auth/username/${encodeURIComponent(name)}`),
  change: (username: string) => authed<{ handle: string }>('/me/handle', { method: 'PUT', body: JSON.stringify({ username }) }),
}

export const profile = {
  /** текущая запись профиля — публично с PDS */
  async get(did: string): Promise<{ displayName: string | null; description: string | null }> {
    // через AppView: он найдёт PDS автора (аккаунт может быть из соседнего контура)
    const res = await fetch(`${BASE}/profile-record/${encodeURIComponent(did)}`).catch(() => null)
    const v = res?.ok ? ((await res.json()) as { displayName?: string | null; description?: string | null }) : undefined
    return { displayName: v?.displayName ?? null, description: v?.description ?? null }
  },
  update: (b: { displayName?: string | null; description?: string | null }) => authed<ProfileView>('/me/profile', { method: 'PATCH', body: JSON.stringify(b) }),
  setAvatar: (file: File) => authed<ProfileView>('/me/avatar', { method: 'POST', body: file, headers: { 'content-type': file.type || 'application/octet-stream' } }),
  removeAvatar: () => authed<ProfileView>('/me/avatar', { method: 'DELETE' }),
}

/** Период охлаждения: 24 ч запись только на сайте; автор правит или удаляет без следа в сети */
export interface PendingItem { uri: string; record: { title?: string; subtitle?: string; text?: string; tags?: string[]; noindex?: boolean; source?: { url?: string; site?: string; publishedAt?: string; crawledAt?: string }; createdAt?: string }; pendingUntil?: string; scheduledAt?: string }
export const pending = {
  /** мои записи в охлаждении (включая отложенные, ещё не вышедшие на сайте) */
  list: () => authed<{ items: PendingItem[] }>('/me/pending'),
  /** publishAt — перенести выход на сайте (в AT — через 24 ч) или null — снять отложенность; republished=null — убрать перепечатку */
  update: (uri: string, b: { title?: string; subtitle?: string; text: string; excerpt?: string; tags?: string[]; noindex?: boolean; republished?: { url: string; publishedAt?: string } | null; publishAt?: string | null }) =>
    authed<{ uri: string }>(`/me/pending?${new URLSearchParams({ uri })}`, { method: 'PUT', body: JSON.stringify(b) }),
  toDraft: (uri: string) => authed<{ draft: Draft }>(`/me/pending/to-draft?${new URLSearchParams({ uri })}`, post({})),
  remove: (uri: string) => authed<{ ok: true }>(`/me/pending?${new URLSearchParams({ uri })}`, { method: 'DELETE' }),
}

/** Совместное редактирование черновика по ссылке /shared-draft/<token>: 24 ч, только для вошедших */
export interface SharedPerson { did: string; handle: string | null; displayName: string | null }
export interface SharedDraftView { token: string; title: string; text: string; owner: SharedPerson; isOwner: boolean; expiresAt: string; reviewers: SharedPerson[] }
export const shared = {
  create: (draftId: string) => authed<{ token: string; expiresAt: string }>(`/me/drafts/${encodeURIComponent(draftId)}/share`, { method: 'POST' }),
  ofDraft: (draftId: string) => authed<{ token: string | null; expiresAt: string | null; reviewers: SharedPerson[] }>(`/me/drafts/${encodeURIComponent(draftId)}/share`),
  get: (token: string) => authed<SharedDraftView>(`/shared/${encodeURIComponent(token)}`),
  updates: (token: string, after: number) => authed<{ updates: { seq: number; data: string }[] }>(`/shared/${encodeURIComponent(token)}/updates?after=${after}`),
  push: (token: string, b: { data: string; edited?: boolean; seed?: boolean }) => authed<{ seq: number }>(`/shared/${encodeURIComponent(token)}/updates`, post(b)),
  saveText: (token: string, b: { title: string; text: string }) => authed<{ ok: true }>(`/shared/${encodeURIComponent(token)}/text`, { method: 'PUT', body: JSON.stringify(b) }),
}

/** превью ссылки для карточки «/link» в редакторе — страницу грузит AppView (из браузера CORS не пустит) */
export interface LinkPreview { url: string; title: string | null; description: string | null; image: string | null; icon: string | null }
export const linkPreview = (url: string, signal?: AbortSignal) => authed<LinkPreview>('/link-preview', { ...post({ url }), signal })

/** Черновики статей: личные, на сервере (не в публичном репозитории); text — markdown редактора */
export interface Draft { id: string; title: string; text: string; meta?: Record<string, unknown>; createdAt: string; updatedAt: string }
export interface DraftSummary { id: string; title: string; excerpt: string; updatedAt: string }

export const drafts = {
  list: () => authed<{ drafts: DraftSummary[] }>('/me/drafts'),
  get: (id: string) => authed<Draft>(`/me/drafts/${encodeURIComponent(id)}`),
  create: (b: { title: string; text: string; meta?: Record<string, unknown> }) => authed<Draft>('/me/drafts', post(b)),
  save: (id: string, b: { title: string; text: string; meta?: Record<string, unknown> }) => authed<Draft>(`/me/drafts/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(b) }),
  remove: (id: string) => authed<{ ok: true }>(`/me/drafts/${encodeURIComponent(id)}`, { method: 'DELETE' }),
}

export const collections = {
  list: () => call<{ collections: Collection[] }>('/collections'),
  get: (id: string) => call<Collection>(`/collections/${encodeURIComponent(id)}`),
  mine: () => authed<{ collections: Collection[] }>('/me/collections'),
  create: (b: Omit<Collection, 'authorHandle' | 'id'> & { id?: string }) => authed<Collection>('/me/collections', post(b)),
  save: (id: string, b: Pick<Collection, 'title' | 'description' | 'articleIds'>) =>
    authed<Collection>(`/me/collections/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(b) }),
}

export const imports = {
  fromAtproto: () => authed<{ added: number; seen: number; complete: boolean }>('/me/imports/atproto', post({})),
  list: (status?: ImportDraft['status']) => authed<{ drafts: ImportDraft[] }>(`/me/imports${status ? `?status=${status}` : ''}`),
  get: (id: string) => authed<ImportDraft>(`/me/imports/${encodeURIComponent(id)}`),
  setStatus: (id: string, status: ImportDraft['status'], articleUri?: string) =>
    authed<ImportDraft>(`/me/imports/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ status, ...(articleUri ? { articleUri } : {}) }) }),
}

/** Обращение в поддержку или запрос органа: на сервер (видят сотрудники в /admin/tickets) */
export const support = {
  create: (b: {
    kind: 'support' | 'legal'
    category: string
    email: string
    handle?: string
    articleUrl?: string
    subject: string
    message: string
    countryFrom?: string
    countryTo?: string
    docType?: string
    docFile?: { name: string; size: number; type: string }
  }) =>
    // вошедшему сервер привяжет DID — сотрудник увидит, чей аккаунт
    hasSession() ? authed<{ id: string; status: string; createdAt: string }>('/support/tickets', post(b)) : call<{ id: string; status: string; createdAt: string }>('/support/tickets', post(b)),
}

export interface MyTicket {
  id: string
  category: string
  subject: string
  message: string
  status: 'new' | 'in_progress' | 'waiting' | 'resolved' | 'rejected'
  createdAt: string
  messages: { id: string; author: 'staff' | 'user'; text: string; createdAt: string }[]
  /** новые ответы сотрудника */
  unread: number
}

/** Свои обращения (отправленные из аккаунта): переписка с поддержкой */
export const myTickets = {
  list: () => authed<MyTicket[]>('/me/tickets'),
  seen: (id: string) => authed<{ ok: true }>(`/me/tickets/${encodeURIComponent(id)}/seen`, post({})),
  reply: (id: string, text: string) => authed<MyTicket>(`/me/tickets/${encodeURIComponent(id)}/messages`, post({ text })),
}

export interface ThreadComment {
  uri: string
  did: string
  handle: string | null
  text: string
  createdAt: string
  /** uri комментария, на который это ответ */
  parent: string | null
  /** период охлаждения: в AT уйдёт в это время */
  pendingUntil?: string
}

export interface AuthorComment {
  uri: string
  text: string
  createdAt: string
  parent: string | null
  /** статья */
  subject: string
  /** null — статьи нет в индексе */
  subjectTitle: string | null
}

/** Комментарии статей из индекса: запись media.weat.comment в репозитории читателя */
export const comments = {
  thread: (subject: string) => call<{ comments: ThreadComment[] }>(`/feed/comments?${new URLSearchParams({ subject })}`),
  /** комментарии пользователя, новые сверху — для профиля */
  byAuthor: (did: string) => call<{ comments: AuthorComment[] }>(`/feed/comments?${new URLSearchParams({ author: did })}`),
  create: (b: { subject: string; parent?: string; text: string }) => authed<ThreadComment>('/me/comments', post(b)),
  remove: (rkey: string) => authed<{ ok: true }>(`/me/comments/${encodeURIComponent(rkey)}`, { method: 'DELETE' }),
}

/** Закрытая часть платной статьи: сервер сам решает, открыть ли её (автор, купивший, подписчик тира) */
export const paidContent = {
  /** null — доступа нет (402) */
  get: async (id: string): Promise<{ body: string } | null> => {
    try {
      return await authed<{ body: string }>(`/paid-content/${encodeURIComponent(id)}`)
    } catch (err) {
      if (err instanceof ApiError && (err.status === 402 || err.status === 401)) return null
      throw err
    }
  },
}

export interface Purchase {
  orderId: string
  status: 'pending' | 'paid' | 'failed' | 'refunded'
  /** заказ Premium (prm_…): contentId нет, есть срок */
  kind?: 'premium'
  paidUntil?: string | null
  contentId: string
  amount: number
  currency: string
}

/** Оплата через lava.top: счёт -> страница оплаты -> /purchase/:orderId ждёт подтверждения */
export const payments = {
  buy: (contentId: string, returnTo: string, paymentMethod?: 'CARD' | 'SBP') =>
    authed<{ orderId: string; paymentUrl: string | null }>('/me/purchases', post({ contentId, returnTo, paymentMethod, utm: lastTouchUtm() })),
  premium: (paymentMethod?: 'CARD' | 'SBP') => authed<{ orderId: string; paymentUrl: string | null }>('/me/premium', post({ paymentMethod })),
  status: (orderId: string) => authed<Purchase>(`/me/purchases/${encodeURIComponent(orderId)}`),
}

export interface OwnershipClaim {
  id: string
  status: 'pending' | 'approved' | 'rejected' | 'transferred'
  sourceSite: string
  /** null — заявка только на одну статью */
  sourceAuthor: string | null
  sourceAuthorUrl: string | null
  articleUri: string
  code: string
  note: string | null
  decisionNote: string | null
  createdAt: string
  decidedAt: string | null
}

/** «Я автор оригинала»: заявка на автора источника, подтверждение — код в профиле на сайте */
export const claims = {
  create: (articleUri: string, note?: string) => authed<OwnershipClaim>('/me/claims', post({ articleUri, note })),
  mine: () => authed<OwnershipClaim[]>('/me/claims'),
  /** одобренная заявка: статьи переходят в ваш репозиторий */
  transfer: (id: string) => authed<{ moved: number; articles: { oldUri: string; newUri: string }[] }>(`/me/claims/${encodeURIComponent(id)}/transfer`, post({})),
}

export const api = {
  identities: () => authed<IdentitiesView>('/me/identities'),
  /** URL для перехода к провайдеру; cookie состояния ставит сервер */
  linkAtproto: (handle: string, returnTo: string) =>
    authed<{ url: string }>('/me/identities/atproto/link', { method: 'POST', body: JSON.stringify({ handle, returnTo }) }),
  linkOAuth: (provider: OAuthProvider, returnTo: string) =>
    authed<{ url: string }>(`/me/identities/${provider}/link`, {
      method: 'POST',
      body: JSON.stringify({ returnTo }),
      credentials: 'same-origin',
    }),
  unlink: (provider: Provider) => authed<IdentitiesView>(`/me/identities/${provider}`, { method: 'DELETE' }),
  geo: () => call<GeoInfo>('/geo'),
  /** обмен одноразового кода после OAuth-редиректа на сессию */
  async handoff(code: string) {
    return finish(await call<GatedResponse>('/auth/handoff', post({ code })))
  },
  /** второй шаг: код из приложения или резервный код */
  async mfa(mfaToken: string, code: string) {
    return finish(await call<GatedResponse>('/auth/mfa', post({ mfaToken, code })))
  },
  getSettings: () => authed<{ data: ServerSettings; updatedAt: string | null }>('/me/settings'),
  patchSettings: (patch: ServerSettings) =>
    authed<{ data: ServerSettings; updatedAt: string }>('/me/settings', {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),
  user: (handleOrDid: string) => call<ApiUser>(`/users/${encodeURIComponent(handleOrDid)}`),
  /** свой профиль с сервера: тариф и имя могли смениться (Premium из админки, правка профиля) */
  me: () => authed<ApiUser>('/me'),
  async register(body: { username: string; email: string; password: string; displayName?: string }) {
    const s = await call<SessionResponse>('/auth/register', { method: 'POST', body: JSON.stringify({ ...body, consent: { personalData: true, terms: true }, utm: firstTouchUtm() }) })
    saveSession(s)
    return toUser(s.user)
  },
  /** ApiError AuthFactorTokenRequired — PDS отправил код на почту, повторить с authFactorToken */
  async login(identifier: string, password: string, authFactorToken?: string) {
    return finish(await call<GatedResponse>('/auth/login', post({ identifier, password, authFactorToken })))
  },
}

/** 'RU' -> «🇷🇺 Россия»; 'ZZ' -> «не определена» */
export function countryLabel(code: string, locale = 'ru'): string {
  if (!/^[A-Z]{2}$/.test(code) || code === 'ZZ') return 'не определена'
  const flag = String.fromCodePoint(...[...code].map((ch) => 0x1f1e6 + ch.charCodeAt(0) - 65))
  let name = code
  try {
    name = new Intl.DisplayNames([locale], { type: 'region' }).of(code) ?? code
  } catch {
    /* старый браузер без Intl.DisplayNames */
  }
  return `${flag} ${name}`
}
