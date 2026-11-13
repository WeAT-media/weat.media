import { firstTouchUtm, lastTouchUtm } from '@/lib/utm'
import type { BlockDef } from '@/lib/userBlocks'
import type { EditorPreferences, LabelerSettings, Preferences, SubscriptionTier, User } from '@/types/types'

/** Ответы AppView (server/src/app.ts) */
export interface ApiUser {
  /** только в публичном профиле: число платных подписчиков */
  paidSubscribers?: number
  did: string
  handle: string
  displayName: string | null
  tier: 'free' | 'premium'
  premiumSince: string | null
  createdAt: string
  signupCountry: string
}

export interface GeoInfo {
  country: string
  contour: 'global' | 'ru'
  allowed: boolean
  /** внешние провайдеры, которыми можно войти с этой страницы (с учётом контура) */
  providers: Provider[]
}

export type Provider = 'yandex' | 'google' | 'github' | 'telegram' | 'atproto'
export type OAuthProvider = Exclude<Provider, 'telegram' | 'atproto'>

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

/** Поля Telegram Login Widget (tgAuthResult) */
export type TelegramAuthData = Record<string, string | number>

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

const SESSION_KEY = 'indie-media:session'
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

function loadSession(): Tokens | null {
  if (memTokens) return memTokens
  try {
    const raw = localStorage.getItem(SESSION_KEY)
    memTokens = raw ? (JSON.parse(raw) as Tokens) : null
  } catch {
    memTokens = null
  }
  return memTokens
}

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

/** Запрос от имени пользователя; при истёкшем access-токене один раз обновляет сессию */
async function authed<T>(path: string, init: RequestInit = {}): Promise<T> {
  const tokens = loadSession()
  if (!tokens) throw new ApiError(401, 'AuthenticationRequired', 'Нужно войти')
  const withAuth = (t: Tokens) => ({ ...init, headers: { ...init.headers, authorization: `Bearer ${t.accessJwt}` } })
  try {
    return await call<T>(path, withAuth(tokens))
  } catch (err) {
    if (!(err instanceof ApiError) || err.status !== 401) throw err
    // параллельные запросы ждут одно обновление, а не гоняют refreshJwt наперегонки
    refreshing ??= call<SessionResponse>('/auth/refresh', {
      method: 'POST',
      body: JSON.stringify({ refreshJwt: tokens.refreshJwt }),
    })
      .then(saveSession, (e) => {
        clearSession()
        throw e
      })
      .finally(() => {
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
  }
}

/** Серверные настройки пользователя: каждый раздел заменяется целиком */
export interface ServerSettings {
  prefs?: Preferences
  editorPrefs?: EditorPreferences
  labelers?: Record<string, LabelerSettings>
  juryOptOut?: boolean
  payoutConnected?: boolean
  tiers?: SubscriptionTier[]
  blockDefs?: BlockDef[]
  payoutDetails?: { country: string; method: 'fiat' | 'crypto'; asset: string; network: string; cryptoAddress: string }
}

export function atprotoStartUrl(handle: string, returnTo: string): string {
  return `${BASE}/auth/atproto/start?${new URLSearchParams({ handle, returnTo })}`
}

/** consent — отметка согласия на ПДн: нужна, если через провайдера создаётся новый аккаунт */
export function oauthStartUrl(provider: OAuthProvider, returnTo: string, consent = false): string {
  const utm = firstTouchUtm()
  const q = new URLSearchParams({ returnTo })
  if (consent) q.set('consent', '1')
  if (utm) for (const [k, v] of Object.entries(utm)) if (v) q.set(`utm_${k}`, v)
  return `${BASE}/auth/${provider}/start?${q}`
}

/** Telegram Login: редирект на oauth.telegram.org, ответ вернётся на /auth/telegram#tgAuthResult=... */
export async function telegramAuthUrl(mode: 'login' | 'link', returnTo: string): Promise<string> {
  const { botId } = await call<{ botId: string }>('/auth/telegram/config')
  const back = new URL('/auth/telegram', window.location.origin)
  back.search = new URLSearchParams({ mode, returnTo }).toString()
  const u = new URL('https://oauth.telegram.org/auth')
  u.search = new URLSearchParams({
    bot_id: botId,
    origin: window.location.origin,
    request_access: 'write',
    return_to: back.toString(),
  }).toString()
  return u.toString()
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
  requestEmailConfirmation: () => authed<{ ok: true }>('/me/email/confirm/request', post({})),
  confirmEmail: (code: string) => authed<SecurityView>('/me/email/confirm', post({ code })),
  /** выключение: первый вызов без кода шлёт письмо и возвращает { codeSent } */
  setEmail2fa: (enabled: boolean, code?: string) =>
    authed<SecurityView | { codeSent: true }>('/me/2fa/email', post({ enabled, code })),
  totpSetup: () => authed<{ secret: string; otpauthUrl: string }>('/me/2fa/totp/setup', post({})),
  // refreshJwt — чтобы текущая сессия пережила включение TOTP (сервер отмечает её как прошедшую 2FA)
  totpEnable: (code: string) =>
    authed<{ backupCodes: string[]; security: SecurityView }>('/me/2fa/totp/enable', post({ code, refreshJwt: loadSession()?.refreshJwt })),
  totpDisable: (code: string) => authed<SecurityView>('/me/2fa/totp/disable', post({ code })),
  regenerateBackupCodes: (code: string) => authed<{ backupCodes: string[] }>('/me/2fa/backup-codes', post({ code })),
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

export interface Purchase {
  orderId: string
  status: 'pending' | 'paid' | 'failed' | 'refunded'
  contentId: string
  amount: number
  currency: string
}

/** Оплата через lava.top: счёт -> страница оплаты -> /purchase/:orderId ждёт подтверждения */
export const payments = {
  buy: (contentId: string, returnTo: string, paymentMethod?: 'CARD' | 'SBP') =>
    authed<{ orderId: string; paymentUrl: string | null }>('/me/purchases', post({ contentId, returnTo, paymentMethod, utm: lastTouchUtm() })),
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
  linkTelegram: (data: TelegramAuthData) =>
    authed<{ ok: true }>('/me/identities/telegram', { method: 'POST', body: JSON.stringify(data) }),
  unlink: (provider: Provider) => authed<IdentitiesView>(`/me/identities/${provider}`, { method: 'DELETE' }),
  async telegramLogin(data: TelegramAuthData) {
    return finish(await call<GatedResponse>('/auth/telegram/login', post(data)))
  },
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
