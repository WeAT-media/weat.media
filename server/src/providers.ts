import { createHash, createHmac, timingSafeEqual } from 'node:crypto'

export type Provider = 'yandex' | 'google' | 'github' | 'telegram' | 'atproto'
export type OAuthProviderId = Exclude<Provider, 'telegram' | 'atproto'>

export const PROVIDERS: Provider[] = ['yandex', 'atproto', 'google', 'github', 'telegram']

/**
 * 149-ФЗ (ред. 406-ФЗ): российских пользователей авторизуют только российские системы.
 * Иностранный провайдер запрещён в РФ-контуре и для аккаунтов со страной регистрации RU.
 */
export const PROVIDER_ORIGIN: Record<Provider, 'ru' | 'foreign'> = {
  yandex: 'ru',
  google: 'foreign',
  github: 'foreign',
  telegram: 'foreign',
  // юрисдикцию чужого PDS не проверить: считаем иностранным
  atproto: 'foreign',
}

export function providerAllowed(p: Provider, contour: 'global' | 'ru', signupCountry?: string): boolean {
  if (PROVIDER_ORIGIN[p] === 'ru') return true
  return contour !== 'ru' && signupCountry !== 'RU'
}

export function isProvider(v: string): v is Provider {
  return (PROVIDERS as string[]).includes(v)
}

export interface ExternalProfile {
  id: string
  login: string
  email: string | null
  displayName: string | null
}

export interface OAuthClient {
  authorizeUrl(state: string, redirectUri: string): string
  exchangeCode(code: string, redirectUri: string): Promise<ExternalProfile>
}

interface Spec {
  authorize: string
  token: string
  scope: string
  extraAuthorize?: Record<string, string>
  profile(accessToken: string): Promise<ExternalProfile>
}

async function getJson(url: string, headers: Record<string, string>): Promise<Record<string, unknown>> {
  const res = await fetch(url, { headers })
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (!res.ok) throw new Error(`${new URL(url).host}: ${res.status}`)
  return data
}

const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null)

/** base переопределяет хосты провайдера на тестовом стенде */
function specFor(p: OAuthProviderId, base?: string): Spec {
  const at = (real: string) => (base ? new URL(new URL(real).pathname, base).toString() : real)
  switch (p) {
    case 'yandex':
      return {
        authorize: at('https://oauth.yandex.ru/authorize'),
        token: at('https://oauth.yandex.ru/token'),
        scope: 'login:email login:info',
        extraAuthorize: { force_confirm: 'no' },
        async profile(t) {
          const i = await getJson(at('https://login.yandex.ru/info?format=json'), { authorization: `OAuth ${t}` })
          return { id: String(i.id), login: String(i.login), email: str(i.default_email), displayName: str(i.display_name) }
        },
      }
    case 'google':
      return {
        authorize: at('https://accounts.google.com/o/oauth2/v2/auth'),
        token: at('https://oauth2.googleapis.com/token'),
        scope: 'openid email profile',
        extraAuthorize: { prompt: 'select_account' },
        async profile(t) {
          const i = await getJson(at('https://openidconnect.googleapis.com/v1/userinfo'), { authorization: `Bearer ${t}` })
          const email = i.email_verified === true ? str(i.email) : null
          return { id: String(i.sub), login: email ?? String(i.sub), email, displayName: str(i.name) }
        },
      }
    case 'github':
      return {
        authorize: at('https://github.com/login/oauth/authorize'),
        token: at('https://github.com/login/oauth/access_token'),
        scope: 'read:user user:email',
        async profile(t) {
          const h = { authorization: `Bearer ${t}`, 'user-agent': 'indie-media-appview', accept: 'application/vnd.github+json' }
          const i = await getJson(at('https://api.github.com/user'), h)
          return { id: String(i.id), login: String(i.login), email: str(i.email), displayName: str(i.name) }
        },
      }
  }
}

export function createOAuthClient(
  p: OAuthProviderId,
  opts: { clientId: string; clientSecret: string; baseUrl?: string },
): OAuthClient {
  const spec = specFor(p, opts.baseUrl)
  return {
    authorizeUrl(state, redirectUri) {
      const u = new URL(spec.authorize)
      u.search = new URLSearchParams({
        response_type: 'code',
        client_id: opts.clientId,
        redirect_uri: redirectUri,
        state,
        scope: spec.scope,
        ...spec.extraAuthorize,
      }).toString()
      return u.toString()
    },
    async exchangeCode(code, redirectUri) {
      const res = await fetch(spec.token, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          client_id: opts.clientId,
          client_secret: opts.clientSecret,
          redirect_uri: redirectUri,
        }),
      })
      const token = (await res.json().catch(() => ({}))) as { access_token?: string; error?: string }
      if (!res.ok || !token.access_token) throw new Error(`${p} token: ${token.error ?? res.status}`)
      return spec.profile(token.access_token)
    },
  }
}

/** Данные Telegram Login Widget: https://core.telegram.org/widgets/login#checking-authorization */
export interface TelegramAuth {
  id: number
  first_name?: string
  last_name?: string
  username?: string
  photo_url?: string
  auth_date: number
  hash: string
}

export function verifyTelegram(data: TelegramAuth, botToken: string, maxAgeSec = 600, now = Date.now()): ExternalProfile | null {
  const { hash, ...fields } = data
  const checkString = Object.entries(fields)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n')
  const secret = createHash('sha256').update(botToken).digest()
  const expected = createHmac('sha256', secret).update(checkString).digest()
  const got = Buffer.from(hash, 'hex')
  if (got.length !== expected.length || !timingSafeEqual(got, expected)) return null
  if (now / 1000 - data.auth_date > maxAgeSec) return null
  const name = [data.first_name, data.last_name].filter(Boolean).join(' ') || null
  return { id: String(data.id), login: data.username ?? String(data.id), email: null, displayName: name }
}
