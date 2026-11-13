import * as oauth from 'oauth4webapi'

/**
 * Вход сотрудников через Zitadel: OIDC authorization code + PKCE, без секрета в браузере.
 * Access-токен — только в sessionStorage этой вкладки (закрыли — вышли); роли внутри токена
 * проверяют AppView и краулер. 2FA для сотрудников требует политика Zitadel.
 */

const env = import.meta.env
export const ZITADEL_ISSUER: string | undefined = env.VITE_ZITADEL_ISSUER
const CLIENT_ID: string | undefined = env.VITE_ZITADEL_CLIENT_ID
const PROJECT_ID: string | undefined = env.VITE_ZITADEL_PROJECT_ID

export const staffAuthConfigured = !!(ZITADEL_ISSUER && CLIENT_ID && PROJECT_ID)

const KEY = 'weat-staff'
const PENDING = 'weat-staff-pending'
const insecure = ZITADEL_ISSUER?.startsWith('http://') ?? false
const opts = { [oauth.allowInsecureRequests]: insecure }

const client = (): oauth.Client => ({ client_id: CLIENT_ID! })
const redirectUri = () => `${window.location.origin}/auth/callback`

let asCache: Promise<oauth.AuthorizationServer> | null = null
function authServer() {
  const issuer = new URL(ZITADEL_ISSUER!)
  asCache ??= oauth.discoveryRequest(issuer, { ...opts, algorithm: 'oidc' }).then((r) => oauth.processDiscoveryResponse(issuer, r))
  return asCache
}

interface StaffSession {
  accessToken: string
  idToken?: string
  expiresAt: number
}

function read<T>(storage: Storage, key: string): T | null {
  try {
    const raw = storage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

export function staffToken(): string | null {
  const s = read<StaffSession>(sessionStorage, KEY)
  // запас 30 с, чтобы токен не истёк по дороге
  return s && s.expiresAt - 30_000 > Date.now() ? s.accessToken : null
}

/** уводит на страницу входа Zitadel; после входа вернёт на returnTo */
export async function staffLogin(returnTo: string) {
  const as = await authServer()
  const verifier = oauth.generateRandomCodeVerifier()
  const state = oauth.generateRandomState()
  sessionStorage.setItem(PENDING, JSON.stringify({ verifier, state, returnTo }))
  const url = new URL(as.authorization_endpoint!)
  url.search = new URLSearchParams({
    client_id: CLIENT_ID!,
    redirect_uri: redirectUri(),
    response_type: 'code',
    // роли проекта в токене + аудитория проекта (её проверяют AppView и краулер)
    scope: `openid profile email urn:zitadel:iam:org:project:id:${PROJECT_ID}:aud urn:zitadel:iam:org:projects:roles`,
    code_challenge: await oauth.calculatePKCECodeChallenge(verifier),
    code_challenge_method: 'S256',
    state,
  }).toString()
  window.location.assign(url)
}

/** /auth/callback: обмен кода на токены; возвращает, куда вернуть сотрудника */
export async function staffCallback(current: URL): Promise<string> {
  const pending = read<{ verifier: string; state: string; returnTo: string }>(sessionStorage, PENDING)
  sessionStorage.removeItem(PENDING)
  if (!pending) throw new Error('Сессия входа устарела. Начните вход заново.')
  const as = await authServer()
  const params = oauth.validateAuthResponse(as, client(), current, pending.state)
  const res = await oauth.authorizationCodeGrantRequest(as, client(), oauth.None(), params, redirectUri(), pending.verifier, opts)
  const t = await oauth.processAuthorizationCodeResponse(as, client(), res)
  const session: StaffSession = {
    accessToken: t.access_token,
    idToken: t.id_token,
    expiresAt: Date.now() + (t.expires_in ?? 3600) * 1000,
  }
  sessionStorage.setItem(KEY, JSON.stringify(session))
  return pending.returnTo.startsWith('/') && !pending.returnTo.startsWith('//') ? pending.returnTo : '/admin'
}

export async function staffLogout() {
  const s = read<StaffSession>(sessionStorage, KEY)
  sessionStorage.removeItem(KEY)
  const as = await authServer().catch(() => null)
  if (as?.end_session_endpoint && s?.idToken) {
    const url = new URL(as.end_session_endpoint)
    url.search = new URLSearchParams({ id_token_hint: s.idToken, post_logout_redirect_uri: `${window.location.origin}/` }).toString()
    window.location.assign(url)
  } else window.location.assign('/')
}
