import { createHash, randomBytes } from 'node:crypto'
import { createRemoteJWKSet, jwtVerify } from 'jose'

export type Provider = 'yandex' | 'google' | 'github' | 'telegram' | 'atproto'
export type OAuthProviderId = Exclude<Provider, 'atproto'>

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
  /** true — провайдер требует PKCE: verifier хранится в состоянии входа и уходит в exchangeCode */
  pkce?: boolean
  authorizeUrl(state: string, redirectUri: string, codeVerifier?: string): string
  exchangeCode(code: string, redirectUri: string, codeVerifier?: string): Promise<ExternalProfile>
}

/** PKCE (RFC 7636): verifier — случайная строка, challenge — base64url(SHA-256(verifier)) */
export const newCodeVerifier = () => randomBytes(32).toString('base64url')
const codeChallenge = (verifier: string) => createHash('sha256').update(verifier).digest('base64url')

interface Spec {
  authorize: string
  token: string
  scope: string
  extraAuthorize?: Record<string, string>
  pkce?: boolean
  /** client_id:client_secret в заголовке Basic, а не в теле */
  basicAuth?: boolean
  /** профиль из ответа токена: id_token (OIDC без userinfo) или access_token */
  profile(token: { access_token?: string; id_token?: string }): Promise<ExternalProfile>
}

async function getJson(url: string, headers: Record<string, string>): Promise<Record<string, unknown>> {
  const res = await fetch(url, { headers })
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (!res.ok) throw new Error(`${new URL(url).host}: ${res.status}`)
  return data
}

const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null)

/** base переопределяет хосты провайдера на тестовом стенде */
function specFor(p: OAuthProviderId, clientId: string, base?: string): Spec {
  const at = (real: string) => (base ? new URL(new URL(real).pathname, base).toString() : real)
  switch (p) {
    case 'yandex':
      return {
        authorize: at('https://oauth.yandex.ru/authorize'),
        token: at('https://oauth.yandex.ru/token'),
        scope: 'login:email login:info',
        extraAuthorize: { force_confirm: 'no' },
        async profile({ access_token: t }) {
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
        async profile({ access_token: t }) {
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
        async profile({ access_token: t }) {
          const h = { authorization: `Bearer ${t}`, 'user-agent': 'indie-media-appview', accept: 'application/vnd.github+json' }
          const i = await getJson(at('https://api.github.com/user'), h)
          return { id: String(i.id), login: String(i.login), email: str(i.email), displayName: str(i.name) }
        },
      }
    case 'telegram': {
      // Telegram Login (OpenID Connect): код + PKCE, профиль — в подписанном id_token, userinfo нет.
      // aud — id бота (= client_id), подпись — ключами oauth.telegram.org. Email Telegram не отдаёт.
      const jwks = createRemoteJWKSet(new URL(at('https://oauth.telegram.org/.well-known/jwks.json')))
      return {
        authorize: at('https://oauth.telegram.org/auth'),
        token: at('https://oauth.telegram.org/token'),
        scope: 'openid profile',
        pkce: true,
        basicAuth: true,
        async profile({ id_token }) {
          if (!id_token) throw new Error('telegram: нет id_token')
          const { payload: i } = await jwtVerify(id_token, jwks, { issuer: 'https://oauth.telegram.org', audience: clientId })
          const id = String(i.id ?? i.sub)
          return { id, login: str(i.preferred_username) ?? `tg-${id}`, email: null, displayName: str(i.name) }
        },
      }
    }
  }
}

export function createOAuthClient(
  p: OAuthProviderId,
  opts: { clientId: string; clientSecret: string; baseUrl?: string },
): OAuthClient {
  const spec = specFor(p, opts.clientId, opts.baseUrl)
  return {
    pkce: spec.pkce,
    authorizeUrl(state, redirectUri, codeVerifier) {
      const u = new URL(spec.authorize)
      u.search = new URLSearchParams({
        response_type: 'code',
        client_id: opts.clientId,
        redirect_uri: redirectUri,
        state,
        scope: spec.scope,
        ...(spec.pkce && codeVerifier ? { code_challenge: codeChallenge(codeVerifier), code_challenge_method: 'S256' } : {}),
        ...spec.extraAuthorize,
      }).toString()
      return u.toString()
    },
    async exchangeCode(code, redirectUri, codeVerifier) {
      const res = await fetch(spec.token, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          accept: 'application/json',
          ...(spec.basicAuth ? { authorization: `Basic ${Buffer.from(`${opts.clientId}:${opts.clientSecret}`).toString('base64')}` } : {}),
        },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          client_id: opts.clientId,
          ...(spec.basicAuth ? {} : { client_secret: opts.clientSecret }),
          redirect_uri: redirectUri,
          ...(spec.pkce && codeVerifier ? { code_verifier: codeVerifier } : {}),
        }),
      })
      const token = (await res.json().catch(() => ({}))) as { access_token?: string; id_token?: string; error?: string }
      if (!res.ok || !(token.access_token || token.id_token)) throw new Error(`${p} token: ${token.error ?? res.status}`)
      return spec.profile(token)
    },
  }
}
