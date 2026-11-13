import { randomBytes } from 'node:crypto'
import type { Context, Hono } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import type { Identity, IdentityRepo, UserRepo, UserRow } from './db.js'
import { PdsError, type PdsClient, type PdsSession } from './pds.js'
import {
  PROVIDER_ORIGIN,
  PROVIDERS,
  isProvider,
  newCodeVerifier,
  providerAllowed,
  type ExternalProfile,
  type OAuthClient,
  type OAuthProviderId,
  type Provider,
} from './providers.js'
import type { AtprotoAuth } from './atprotoOAuth.js'
import { AtprotoLinkBody, Handle, HandoffBody, OAuthLinkBody, LEGAL_VERSION, Utm, type UtmData } from './schemas.js'
import type { SecretBox } from './secretbox.js'

export interface IdentityDeps {
  config: { CONTOUR: 'global' | 'ru'; PDS_HANDLE_DOMAIN: string; PUBLIC_URL: string }
  users: UserRepo
  identities: IdentityRepo
  pds: PdsClient
  secrets: SecretBox
  oauth: Partial<Record<OAuthProviderId, OAuthClient>>
  atproto?: AtprotoAuth
  peer?: { resolve(handle: string): Promise<string | null> }
}

interface Helpers {
  geoOf(c: Context): { country: string; allowed: boolean }
  sessionDto(s: PdsSession, u: UserRow): { accessJwt: string; refreshJwt: string; user: unknown }
  safeEqual(a: string, b: string): boolean
  bearer(c: Context): string | undefined
  /** TOTP: сессия выдаётся только после второго фактора */
  gate(body: ReturnType<Helpers['sessionDto']>): Promise<unknown>
}

/** Состояние OAuth между start и callback — в зашифрованной httpOnly-cookie */
interface OAuthState {
  state: string
  provider: OAuthProviderId
  mode: 'login' | 'link'
  returnTo: string
  did?: string
  accessJwt?: string
  /** first-touch UTM: регистрация через провайдера тоже атрибутируется */
  utm?: UtmData
  /** отметка согласия на странице входа: без неё новый аккаунт через провайдера не создаётся */
  consent?: boolean
  /** PKCE verifier (Telegram): в зашифрованной cookie, в браузер не попадает */
  pkce?: string
}

const COOKIE = 'oauth_state'
const COOKIE_PATH = '/api/auth'
/**
 * Через каких провайдеров можно создать новый аккаунт: Яндекс ID — везде;
 * AT Protocol — только глобальный контур и не из России (иностранный сервис, 242-ФЗ).
 */
const canRegister = (p: Provider, contour: 'global' | 'ru', country: string) =>
  p === 'yandex' || (p === 'atproto' && contour === 'global' && country !== 'RU')


export function mountIdentityRoutes(app: Hono, d: IdentityDeps, h: Helpers) {
  const secure = d.config.PUBLIC_URL.startsWith('https://')
  const redirectUri = (p: OAuthProviderId) => `${d.config.PUBLIC_URL}/api/auth/${p}/callback`
  const handoff = new Map<string, { body: ReturnType<Helpers['sessionDto']>; exp: number }>()

  const configured = (p: Provider) =>
    p === 'atproto' ? !!d.atproto : !!d.oauth[p]
  const fail = (code: string, message: string, status: 400 | 403 | 404 | 409 = 400) => new PdsError(status, code, message)

  const toLogin = (c: Context, params: Record<string, string>) =>
    c.redirect(`${d.config.PUBLIC_URL}/login?${new URLSearchParams(params)}`)
  const toSettings = (c: Context, returnTo: string, params: Record<string, string>) =>
    c.redirect(`${d.config.PUBLIC_URL}${returnTo}?${new URLSearchParams(params)}`)

  const issueHandoff = (body: ReturnType<Helpers['sessionDto']>) => {
    const code = randomBytes(24).toString('base64url')
    const now = Date.now()
    for (const [k, v] of handoff) if (v.exp < now) handoff.delete(k)
    handoff.set(code, { body, exp: now + 60_000 })
    return code
  }

  // только локальный путь: без //host, /\host (браузер читает \ как /) и управляющих символов
  const safeReturnTo = (raw: string | undefined, fallback: string) =>
    raw && /^\/(?![/\\])[^\s\\]*$/.test(raw) && raw.length <= 300 ? raw : fallback

  /** владелец Bearer-токена; токен нужен для createAppPassword */
  const requireUser = async (c: Context) => {
    const token = h.bearer(c)
    if (!token) throw fail('AuthenticationRequired', 'Нужно войти', 403)
    const { did } = await d.pds.getSession(token)
    const user = await d.users.findByDid(did)
    if (!user) throw fail('NotFound', 'Пользователь не найден', 404)
    return { user, token }
  }

  // ── вход ──────────────────────────────────────────────────────────────
  const loginWith = async (p: Provider, profile: ExternalProfile, c: Context, utm?: UtmData, consent = false) => {
    const existing = await d.identities.find(p, profile.id)
    if (existing) {
      const user = await d.users.findByDid(existing.did)
      if (!user) throw fail('NotFound', 'Пользователь не найден', 404)
      if (!providerAllowed(p, d.config.CONTOUR, user.signup_country)) {
        throw fail('ProviderForbidden', 'Для российских аккаунтов вход через этот сервис запрещён законом. Войдите паролем или через Яндекс ID.', 403)
      }
      // вход открыт из любой страны
      const session = await d.pds.createSession(user.handle, d.secrets.open(existing.pdsPasswordEnc))
      return h.sessionDto(session, user)
    }
    const geo = h.geoOf(c)
    if (!canRegister(p, d.config.CONTOUR, geo.country)) {
      throw fail('NotLinked', 'Этот аккаунт не привязан. Войдите другим способом и привяжите его в настройках.', 404)
    }
    if (!geo.allowed) throw fail('ContourRestricted', 'Регистрация доступна только с российского IP', 403)
    if (!consent) throw fail('ConsentRequired', 'Аккаунта ещё нет. Чтобы создать его, отметьте согласие на обработку персональных данных и повторите вход.')
    return registerWith(p, profile, geo.country, utm)
  }

  const usernameCandidates = (p: ExternalProfile): string[] => {
    let base = p.login.toLowerCase().replace(/@.*$/, '').replace(/[._]+/g, '-').replace(/[^a-z0-9-]/g, '').replace(/^-+|-+$/g, '')
    if (base.length < 3) base = `id-${base || p.id}`.slice(0, 30)
    base = base.slice(0, 25).replace(/-+$/, '')
    return [base, ...[2, 3, 4, 5].map((n) => `${base}-${n}`), `${base}-${randomBytes(2).toString('hex')}`]
  }

  const registerWith = async (p: Provider, profile: ExternalProfile, country: string, utm?: UtmData) => {
    if (!profile.email) throw fail('EmailRequired', 'Провайдер не передал email: разрешите доступ к почте')
    const password = randomBytes(24).toString('base64url')
    for (const username of usernameCandidates(profile)) {
      const handle = `${username}.${d.config.PDS_HANDLE_DOMAIN}`
      // handle общий для контуров: занятый у соседа пропускаем; сосед недоступен — не рискуем дублем
      if (d.peer) {
        const taken = await d.peer.resolve(handle).catch(() => {
          throw fail('PeerUnavailable', 'Не удалось проверить имя. Попробуйте через минуту.', 409)
        })
        if (taken) continue
      }
      try {
        const session = await d.pds.createAccount({
          handle,
          email: profile.email,
          password,
        })
        const user = await d.users.insert({
          did: session.did,
          handle: session.handle,
          displayName: profile.displayName ?? undefined,
          signupCountry: country,
          passwordLogin: false,
          signupUtm: utm,
          consentVersion: LEGAL_VERSION,
        })
        await d.identities.insert({
          provider: p,
          providerUserId: profile.id,
          did: session.did,
          pdsPasswordEnc: d.secrets.seal(password),
          display: profile.email ?? profile.login,
          appPasswordName: null,
        })
        return h.sessionDto(session, user)
      } catch (err) {
        if (err instanceof PdsError && (err.code === 'HandleTaken' || err.code === 'HandleNotAvailable')) continue
        throw err
      }
    }
    throw fail('HandleTaken', 'Не удалось подобрать свободный username', 409)
  }

  // ── привязка ──────────────────────────────────────────────────────────
  const linkTo = async (user: UserRow, accessJwt: string, p: Provider, profile: ExternalProfile) => {
    // привязка разрешена всем; входить через иностранный сервис российскому аккаунту нельзя (loginWith)
    const owner = await d.identities.find(p, profile.id)
    if (owner && owner.did !== user.did) throw fail('IdentityInUse', 'Этот аккаунт уже привязан к другому пользователю', 409)
    if (owner) return
    if ((await d.identities.listByDid(user.did)).some((i) => i.provider === p)) {
      throw fail('AlreadyLinked', 'У вас уже привязан другой аккаунт этого сервиса — сначала отвяжите его', 409)
    }
    const name = `indie-${p}-${randomBytes(3).toString('hex')}`
    let appPassword: string
    try {
      appPassword = (await d.pds.createAppPassword(accessJwt, name)).password
    } catch (err) {
      // сессия, открытая через app password, не может создавать новые
      if (err instanceof PdsError && err.status < 500) {
        throw fail('FullSessionRequired', 'Чтобы привязать аккаунт, войдите паролем или через аккаунт, которым регистрировались', 403)
      }
      throw err
    }
    await d.identities.insert({
      provider: p,
      providerUserId: profile.id,
      did: user.did,
      pdsPasswordEnc: d.secrets.seal(appPassword),
      display: profile.email ?? (p === 'yandex' || p === 'google' ? profile.login : `@${profile.login}`),
      appPasswordName: name,
    })
  }

  // ── AT Protocol: внешний PDS (bsky.social, свой сервер) ────────────────
  // регистрируются раньше общих /auth/:provider/*, иначе их перехватит общий маршрут

  const requireAtproto = () => {
    if (!d.atproto) throw fail('NotConfigured', 'Вход через AT Protocol не настроен', 404)
    return d.atproto
  }
  /** nonce в httpOnly-cookie + в state: callback принимается только в том браузере, где вход начат (login CSRF) */
  const ATP_COOKIE = 'atproto_nonce'
  const atprotoAuthorize = async (c: Context, handle: string, s: Omit<OAuthState, 'state' | 'provider'>) => {
    const nonce = randomBytes(16).toString('base64url')
    setCookie(c, ATP_COOKIE, nonce, { httpOnly: true, secure, sameSite: 'Lax', path: COOKIE_PATH, maxAge: 600 })
    try {
      return await requireAtproto().authorize(handle, d.secrets.seal(JSON.stringify({ ...s, nonce })))
    } catch (err) {
      if (err instanceof PdsError) throw err
      throw fail('HandleNotFound', 'Не удалось найти этот AT-аккаунт или его сервер. Проверьте handle.', 404)
    }
  }

  app.get('/oauth/client-metadata.json', (c) => c.json(requireAtproto().clientMetadata))

  app.get('/auth/atproto/start', async (c) => {
    if (!providerAllowed('atproto', d.config.CONTOUR)) {
      return toLogin(c, { error: 'ProviderForbidden' })
    }
    const handle = Handle.safeParse(c.req.query('handle') ?? '')
    const returnTo = safeReturnTo(c.req.query('returnTo'), '/feed')
    if (!handle.success) return toLogin(c, { error: 'HandleNotFound', returnTo })
    try {
      const q = c.req.query()
      const utm = Utm.safeParse({ source: q.utm_source, medium: q.utm_medium, campaign: q.utm_campaign, term: q.utm_term, content: q.utm_content })
      const s = { mode: 'login' as const, returnTo, ...(utm.success ? { utm: utm.data } : {}), consent: q.consent === '1' }
      return c.redirect(await atprotoAuthorize(c, handle.data, s))
    } catch (err) {
      return toLogin(c, { error: err instanceof PdsError ? err.code : 'ProviderFailed', returnTo })
    }
  })

  app.post('/me/identities/atproto/link', async (c) => {
    const { user, token } = await requireUser(c)
    const body = AtprotoLinkBody.safeParse(await c.req.json().catch(() => null))
    if (!body.success) throw fail('HandleNotFound', 'Введите handle, например alice.bsky.social')
    const returnTo = safeReturnTo(body.data.returnTo, `/profile/${user.handle}/settings/accounts`)
    return c.json({ url: await atprotoAuthorize(c, body.data.handle, { mode: 'link', returnTo, did: user.did, accessJwt: token }) })
  })

  app.get('/auth/atproto/callback', async (c) => {
    const atproto = requireAtproto()
    let s: (Omit<OAuthState, 'state' | 'provider'> & { nonce?: string }) | null = null
    let result: Awaited<ReturnType<AtprotoAuth['callback']>>
    const nonce = getCookie(c, ATP_COOKIE)
    deleteCookie(c, ATP_COOKIE, { path: COOKIE_PATH })
    try {
      result = await atproto.callback(new URL(c.req.url).searchParams)
      s = result.appState ? JSON.parse(d.secrets.open(result.appState)) : null
    } catch (err) {
      console.error(err)
      return toLogin(c, { error: 'InvalidState' })
    }
    if (!s || !s.nonce || !nonce || !h.safeEqual(s.nonce, nonce)) return toLogin(c, { error: 'InvalidState' })
    const back = (params: Record<string, string>) =>
      s.mode === 'link' ? toSettings(c, s.returnTo, params) : toLogin(c, { ...params, returnTo: s.returnTo })
    try {
      // аккаунт с нашего PDS — это не «внешний» вход
      if (await d.users.findByDid(result.did)) throw fail('OwnAccount', 'Это аккаунт Indie.media — войдите паролем', 409)
      const profile: ExternalProfile = { id: result.did, login: result.handle ?? result.did, email: result.email, displayName: null }
      if (s.mode === 'link') {
        const user = s.did ? await d.users.findByDid(s.did) : undefined
        if (!user || !s.accessJwt) return back({ error: 'InvalidState' })
        await linkTo(user, s.accessJwt, 'atproto', profile)
        return back({ linked: 'atproto' })
      }
      return back({ handoff: issueHandoff(await loginWith('atproto', profile, c, s.utm, s.consent)) })
    } catch (err) {
      if (!(err instanceof PdsError)) console.error(err)
      return back({ error: err instanceof PdsError ? err.code : 'ProviderFailed', provider: 'atproto' })
    }
  })

  // ── OAuth: Яндекс, Google, GitHub ─────────────────────────────────────
  const startOAuth = (c: Context, s: Omit<OAuthState, 'state'>) => {
    const client = d.oauth[s.provider]!
    const state = randomBytes(16).toString('base64url')
    const pkce = client.pkce ? newCodeVerifier() : undefined
    setCookie(c, COOKIE, d.secrets.seal(JSON.stringify({ ...s, state, ...(pkce ? { pkce } : {}) })), {
      httpOnly: true,
      secure,
      sameSite: 'Lax',
      path: COOKIE_PATH,
      maxAge: 600,
    })
    return client.authorizeUrl(state, redirectUri(s.provider), pkce)
  }

  const oauthProvider = (c: Context): OAuthProviderId => {
    const p = c.req.param('provider') ?? ''
    if (!isProvider(p) || p === 'atproto' || !d.oauth[p]) throw fail('NotConfigured', 'Способ входа не настроен', 404)
    return p
  }

  app.get('/auth/:provider/start', (c) => {
    const provider = oauthProvider(c)
    if (!providerAllowed(provider, d.config.CONTOUR)) {
      throw fail('ProviderForbidden', 'В РФ-контуре этот способ входа недоступен', 403)
    }
    const q = c.req.query()
    const utm = Utm.safeParse({ source: q.utm_source, medium: q.utm_medium, campaign: q.utm_campaign, term: q.utm_term, content: q.utm_content })
    return c.redirect(
      startOAuth(c, { provider, mode: 'login', returnTo: safeReturnTo(q.returnTo, '/feed'), ...(utm.success ? { utm: utm.data } : {}), consent: q.consent === '1' }),
    )
  })

  app.post('/me/identities/:provider/link', async (c) => {
    const provider = oauthProvider(c)
    const { user, token } = await requireUser(c)
    const body = OAuthLinkBody.safeParse(await c.req.json().catch(() => ({})))
    const returnTo = safeReturnTo(body.success ? body.data.returnTo : undefined, `/profile/${user.handle}/settings/accounts`)
    return c.json({ url: startOAuth(c, { provider, mode: 'link', returnTo, did: user.did, accessJwt: token }) })
  })

  app.get('/auth/:provider/callback', async (c) => {
    const provider = oauthProvider(c)
    const raw = getCookie(c, COOKIE)
    deleteCookie(c, COOKIE, { path: COOKIE_PATH })
    let s: OAuthState | null = null
    try {
      s = raw ? (JSON.parse(d.secrets.open(raw)) as OAuthState) : null
    } catch {
      s = null
    }
    const { code, state, error } = c.req.query()
    const back = (params: Record<string, string>) =>
      s?.mode === 'link' ? toSettings(c, s.returnTo, params) : toLogin(c, { ...params, returnTo: s?.returnTo ?? '/feed' })
    if (!s || s.provider !== provider || !state || !h.safeEqual(state, s.state)) return toLogin(c, { error: 'InvalidState' })
    if (error || !code) return back({ error: 'ProviderDenied', provider })

    try {
      const profile = await d.oauth[provider]!.exchangeCode(code, redirectUri(provider), s.pkce)
      if (s.mode === 'link') {
        const user = s.did ? await d.users.findByDid(s.did) : undefined
        if (!user || !s.accessJwt) return back({ error: 'InvalidState' })
        await linkTo(user, s.accessJwt, provider, profile)
        return back({ linked: provider })
      }
      return back({ handoff: issueHandoff(await loginWith(provider, profile, c, s.utm, s.consent)) })
    } catch (err) {
      if (!(err instanceof PdsError)) console.error(err)
      return back({ error: err instanceof PdsError ? err.code : 'ProviderFailed', provider })
    }
  })

  app.post('/auth/handoff', async (c) => {
    const body = HandoffBody.safeParse(await c.req.json().catch(() => null))
    const entry = body.success ? handoff.get(body.data.code) : undefined
    if (body.success) handoff.delete(body.data.code)
    if (!entry || entry.exp < Date.now()) {
      return c.json({ error: 'InvalidCode', message: 'Ссылка входа устарела, попробуйте ещё раз' }, 400)
    }
    return c.json(await h.gate(entry.body))
  })

  // ── список и отвязка ──────────────────────────────────────────────────
  const view = (user: UserRow, linked: Identity[]) => ({
    passwordLogin: user.password_login,
    providers: PROVIDERS.map((p) => {
      const i = linked.find((x) => x.provider === p)
      const loginAllowed = providerAllowed(p, d.config.CONTOUR, user.signup_country)
      return {
        provider: p,
        origin: PROVIDER_ORIGIN[p],
        configured: configured(p),
        loginAllowed,
        linked: i ? { display: i.display, linkedAt: i.createdAt.toISOString(), primary: i.appPasswordName === null } : null,
      }
    }),
  })

  app.get('/me/identities', async (c) => {
    const { user } = await requireUser(c)
    return c.json(view(user, await d.identities.listByDid(user.did)))
  })

  app.delete('/me/identities/:provider', async (c) => {
    const p = c.req.param('provider')
    if (!isProvider(p)) throw fail('NotFound', 'Неизвестный провайдер', 404)
    const { user, token } = await requireUser(c)
    const linked = await d.identities.listByDid(user.did)
    const target = linked.find((i) => i.provider === p)
    if (!target) throw fail('NotFound', 'Этот аккаунт не привязан', 404)
    // нельзя отрезать последний способ входа
    if (!user.password_login && linked.length === 1) {
      throw fail('LastLoginMethod', 'Это единственный способ входа. Сначала привяжите другой или задайте пароль.', 409)
    }
    // у основного аккаунта хранится полный пароль PDS: без него не создать новые привязки
    if (!user.password_login && target.appPasswordName === null) {
      throw fail('PrimaryIdentity', 'Через этот аккаунт вы регистрировались. Сначала задайте пароль.', 409)
    }
    await d.identities.remove(user.did, p)
    if (target.appPasswordName) await d.pds.revokeAppPassword(token, target.appPasswordName).catch(() => {})
    return c.json(view(user, linked.filter((i) => i.provider !== p)))
  })

  /** для /geo: какие кнопки входа показать на странице логина */
  return {
    loginProviders: () => PROVIDERS.filter((p) => configured(p) && providerAllowed(p, d.config.CONTOUR)),
  }
}
