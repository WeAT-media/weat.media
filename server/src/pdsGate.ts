import { randomBytes, timingSafeEqual } from 'node:crypto'
import { request as httpRequest } from 'undici'
import type { Hono } from 'hono'
import type { MfaRepo, UserRepo } from './db.js'
import type { PdsClient } from './pds.js'
import { PEER_HOP_HEADER, type PeerContour } from './contour.js'

/**
 * Вход в PDS снаружи (com.atproto.server.createSession на pds.weat.media) идёт через AppView:
 * Caddy переписывает его сюда. TOTP живёт в AppView, а PDS о нём не знает — без этой проверки
 * утёкший пароль давал бы полный доступ к репозиторию в обход второго фактора.
 *
 *   аккаунт без TOTP          — ответ PDS как есть (клиенты AT, Bluesky и др. работают)
 *   с TOTP, пароль приложения — как есть: app password в AT и есть способ входа сторонних клиентов
 *   с TOTP, основной пароль   — полную сессию сразу отзываем, 401 AuthFactorTokenRequired
 *
 * Сюда же Caddy переписывает createSession с weat.media/xrpc/* — вход в Bluesky с хостингом «weat.media».
 * GeoDNS мог привести на чужой контур: свой PDS аккаунта не знает (401) — спрашиваем гейт соседа,
 * он проверяет TOTP своего пользователя сам. Дальше клиент ходит в PDS из didDoc ответа.
 */

/** scope из payload JWT без проверки подписи: токен только что выдал наш PDS */
function scopeOf(jwt: string): string | null {
  try {
    const payload = JSON.parse(Buffer.from(jwt.split('.')[1] ?? '', 'base64url').toString('utf8')) as { scope?: unknown }
    return typeof payload.scope === 'string' ? payload.scope : null
  } catch {
    return null
  }
}

export function mountPdsGate(app: Hono, d: { pdsUrl?: string; pdsHost?: string; pds: PdsClient; mfa: MfaRepo; peer?: PeerContour; users?: UserRepo; peerSecret?: string; rawRequest?: typeof httpRequest }) {
  app.post('/pds/createSession', async (c) => {
    if (!d.pdsUrl) return c.json({ error: 'NotConfigured', message: 'PDS не настроен' }, 503)
    const body = await c.req.text()
    if (body.length > 10_000) return c.json({ error: 'InvalidRequest', message: 'Слишком большой запрос' }, 413)
    const res = await fetch(new URL('/xrpc/com.atproto.server.createSession', d.pdsUrl), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
      signal: AbortSignal.timeout(15_000),
    }).catch(() => null)
    if (!res) return c.json({ error: 'UpstreamFailure', message: 'PDS не отвечает' }, 502)
    // к соседу — только из внешнего запроса, иначе контуры спрашивали бы друг друга по кругу
    if (res.status === 401 && d.peer && !c.req.header(PEER_HOP_HEADER)) {
      const peer = await fetch(`${d.peer.publicUrl}/api/pds/createSession`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', [PEER_HOP_HEADER]: '1' },
        body,
        signal: AbortSignal.timeout(15_000),
      }).catch(() => null)
      if (peer?.ok) {
        c.header('cache-control', 'no-store')
        return c.json(await peer.json(), 200)
      }
      // сосед знает аккаунт, но отказал (TOTP) — его ответ точнее нашего «неверный пароль»
      if (peer?.status === 401) {
        const err = (await peer.json().catch(() => ({}))) as { error?: string }
        if (err.error === 'AuthFactorTokenRequired') return c.json(err, 401)
      }
    }
    const data = (await res.json().catch(() => ({}))) as { did?: string; accessJwt?: string; refreshJwt?: string }
    if (res.ok && data.did && data.accessJwt && scopeOf(data.accessJwt) === 'com.atproto.access' && (await d.mfa.get(data.did)).totpEnabledAt) {
      if (data.refreshJwt) await d.pds.deleteSession(data.refreshJwt).catch(() => {})
      return c.json(
        {
          error: 'AuthFactorTokenRequired',
          message: 'Включена двухфакторная защита: войдите на weat.media или используйте пароль приложения (Настройки → Безопасность).',
        },
        401,
      )
    }
    c.header('cache-control', 'no-store')
    return c.json(data, res.status as 200)
  })

  /** включён ли TOTP: свой пользователь — по своей базе, чужой — спрашиваем соседа. null — не узнали */
  const totpOf = async (did: string): Promise<boolean | null> => {
    if (!d.users || (await d.users.findByDid(did))) return !!(await d.mfa.get(did)).totpEnabledAt
    if (!d.peer || !d.peerSecret) return false
    const res = await fetch(`${d.peer.publicUrl}/api/peer/totp?${new URLSearchParams({ did })}`, {
      headers: { [PEER_HOP_HEADER]: '1', authorization: `Bearer ${d.peerSecret}` },
      signal: AbortSignal.timeout(5000),
    }).catch(() => null)
    if (!res?.ok) return null
    const b = (await res.json().catch(() => null)) as { totp?: unknown } | null
    return typeof b?.totp === 'boolean' ? b.totp : null
  }

  /**
   * Вход в другие AT-приложения через OAuth (страница входа PDS, pds.weat.media/oauth/authorize): форма шлёт
   * пароль в /@atproto/oauth-provider/~api/sign-in, Caddy переписывает сюда. PDS о нашем TOTP не знает —
   * у аккаунта с TOTP этот вход закрыт целиком, независимо от пароля (ответ не подсказывает, верен ли он).
   * Таким аккаунтам — пароль приложения (Настройки → Безопасность). Остальные запросы идут в PDS как есть:
   * заголовки (Origin, Referer, Sec-Fetch-*, CSRF, cookie устройства) и ответ с Set-Cookie не меняются.
   */
  app.post('/pds/oauth-sign-in', async (c) => {
    if (!d.pdsUrl) return c.json({ error: 'server_error', error_description: 'PDS не настроен' }, 503)
    const body = await c.req.text()
    if (body.length > 10_000) return c.json({ error: 'invalid_request', error_description: 'Слишком большой запрос' }, 413)
    let identifier = ''
    try {
      const v = (JSON.parse(body) as { identifier?: unknown }).identifier
      identifier = typeof v === 'string' ? v : ''
    } catch {
      identifier = ''
    }
    if (identifier) {
      const did = await d.pds.didForIdentifier(identifier).catch(() => null)
      // PDS не ответил — не пропускаем вслепую
      if (did === null) return c.json({ error: 'server_error', error_description: 'Сервер временно недоступен, попробуйте позже' }, 503)
      if (did) {
        const totp = await totpOf(did)
        if (totp === null) return c.json({ error: 'server_error', error_description: 'Не удалось проверить защиту аккаунта, попробуйте позже' }, 503)
        if (totp) {
          return c.json(
            {
              error: 'invalid_request',
              error_description: 'У аккаунта включена двухфакторная защита: войдите паролем приложения (weat.media → Настройки → Безопасность).',
            },
            400,
          )
        }
      }
    }
    const headers = new Headers()
    c.req.raw.headers.forEach((v, k) => {
      if (!['host', 'content-length', 'connection', 'accept-encoding', 'transfer-encoding'].includes(k.toLowerCase())) headers.set(k, v)
    })
    const res = await fetch(new URL('/@atproto/oauth-provider/~api/sign-in', d.pdsUrl), {
      method: 'POST',
      headers,
      body,
      redirect: 'manual',
      signal: AbortSignal.timeout(15_000),
    }).catch(() => null)
    if (!res) return c.json({ error: 'server_error', error_description: 'PDS не отвечает' }, 502)
    const out = new Headers(res.headers)
    out.delete('content-encoding')
    out.delete('content-length')
    return new Response(res.body, { status: res.status, headers: out })
  })

  const oauthBridges = new Map<string, { accessJwt: string; appName: string; identifier: string; password: string; authorize: string }>()
  const publicPdsOrigin = () => `https://${d.pdsHost ?? new URL(d.pdsUrl!).host}`

  /** Соцсети проходят через сайт: здесь полный PDS accessJwt меняется на одноразовый мост к штатной OAuth-сессии. */
  app.post('/pds/oauth/prepare', async (c) => {
    if (!d.pdsUrl) return c.json({ error: 'NotConfigured', message: 'PDS не настроен' }, 503)
    const accessJwt = c.req.header('authorization')?.replace(/^Bearer\s+/i, '') ?? ''
    if (!accessJwt) return c.json({ error: 'AuthenticationRequired', message: 'Требуется вход' }, 401)
    const body = await c.req.text()
    if (body.length > 8_000) return c.json({ error: 'InvalidRequest', message: 'Слишком большой запрос' }, 413)
    let clientId = ''
    let requestUri = ''
    try {
      const v = JSON.parse(body) as { client_id?: unknown; request_uri?: unknown }
      clientId = typeof v.client_id === 'string' ? v.client_id : ''
      requestUri = typeof v.request_uri === 'string' ? v.request_uri : ''
    } catch {
      return c.json({ error: 'InvalidRequest', message: 'Некорректный OAuth-запрос' }, 400)
    }
    if (!/^https:\/\/\S+$/.test(clientId) || !/^urn:ietf:params:oauth:request_uri:\S+$/.test(requestUri)) {
      return c.json({ error: 'InvalidRequest', message: 'Некорректный OAuth-запрос' }, 400)
    }
    let did = ''
    try {
      const payload = JSON.parse(Buffer.from(accessJwt.split('.')[1] ?? '', 'base64url').toString('utf8')) as { sub?: unknown }
      did = typeof payload.sub === 'string' ? payload.sub : ''
    } catch {
      did = ''
    }
    if (!did.startsWith('did:')) return c.json({ error: 'AuthenticationRequired', message: 'Некорректная сессия' }, 401)
    const appName = `oauth-bridge-${randomBytes(8).toString('hex')}`
    const { password } = await d.pds.createAppPassword(accessJwt, appName).catch(() => ({ password: '' }))
    if (!password) return c.json({ error: 'AuthenticationRequired', message: 'Сессия недействительна, войдите снова' }, 401)
    const code = randomBytes(32).toString('base64url')
    const params = new URLSearchParams({ client_id: clientId, request_uri: requestUri })
    const authorize = `${publicPdsOrigin()}/oauth/authorize?${params}`
    oauthBridges.set(code, { accessJwt, appName, identifier: did, password, authorize })
    setTimeout(() => oauthBridges.delete(code), 60_000).unref()
    return c.json({ url: `${publicPdsOrigin()}/oauth/continue?${new URLSearchParams({ code })}` })
  })

  /** Caddy вызывает на домене PDS: Set-Cookie и возврат в authorize остаются на его origin. */
  app.get('/pds/oauth-continue', async (c) => {
    if (!d.pdsUrl) return c.json({ error: 'NotConfigured' }, 503)
    const code = c.req.query('code') ?? ''
    const bridge = oauthBridges.get(code)
    if (!bridge) return c.json({ error: 'InvalidCode', message: 'Ссылка входа истекла, попробуйте снова' }, 400)
    oauthBridges.delete(code)
    try {
      const raw = d.rawRequest ?? httpRequest
      const publicAuthorize = new URL(bridge.authorize)
      const preflight = await raw(new URL(`${publicAuthorize.pathname}${publicAuthorize.search}`, d.pdsUrl), {
        method: 'GET',
        headers: { host: publicAuthorize.host, 'sec-fetch-site': 'same-origin' },
        headersTimeout: 15_000,
        bodyTimeout: 15_000,
      })
      await preflight.body.text()
      const preflightSetCookie = preflight.headers['set-cookie']
      const initialCookies = Array.isArray(preflightSetCookie) ? preflightSetCookie : preflightSetCookie ? [preflightSetCookie] : []
      const cookie = initialCookies.map((v) => v.split(';', 1)[0]).join('; ')
      const csrf = initialCookies.flatMap((v) => {
        const m = /(?:^|;\s*)csrf-token=([^;]+)/i.exec(v)
        return m?.[1] ? [decodeURIComponent(m[1])] : []
      })[0]
      const headers: Record<string, string> = {
        accept: 'application/json',
        'content-type': 'application/json',
        origin: publicPdsOrigin(),
        referer: bridge.authorize,
        'sec-fetch-site': 'same-origin',
        'sec-fetch-mode': 'same-origin',
        ...(cookie ? { cookie } : {}),
        ...(csrf ? { 'x-csrf-token': csrf } : {}),
      }
      // fetch() в Node перезаписывает Sec-Fetch-Mode на cors даже при явном same-origin — undici.request сохраняет заголовок.
      const res = await (d.rawRequest ?? httpRequest)(new URL('/@atproto/oauth-provider/~api/sign-in', d.pdsUrl), {
        method: 'POST',
        headers,
        body: JSON.stringify({ locale: 'ru', identifier: bridge.identifier, password: bridge.password, remember: true }),
        headersTimeout: 15_000,
        bodyTimeout: 15_000,
      })
      const payload = (await res.body.json().catch(() => ({}))) as { error?: string; error_description?: string }
      if (res.statusCode < 200 || res.statusCode >= 300) {
        return c.json({ error: 'UpstreamFailure', message: 'PDS не подтвердил вход, попробуйте снова', upstreamStatus: res.statusCode, upstreamError: payload.error, upstreamDescription: payload.error_description }, 502)
      }
      const responseCookies = Array.isArray(res.headers['set-cookie']) ? res.headers['set-cookie'] : res.headers['set-cookie'] ? [res.headers['set-cookie']] : []
      const out = new Headers({ location: bridge.authorize, 'cache-control': 'no-store' })
      for (const value of [...initialCookies, ...responseCookies]) out.append('set-cookie', value)
      return new Response(null, { status: 302, headers: out })
    } catch {
      return c.json({ error: 'UpstreamFailure', message: 'PDS не отвечает, попробуйте снова' }, 502)
    } finally {
      await d.pds.revokeAppPassword(bridge.accessJwt, bridge.appName).catch(() => {})
    }
  })

  /** соседнему контуру: включён ли TOTP у моего пользователя — только с общим ключом контуров */
  app.get('/peer/totp', async (c) => {
    const key = c.req.header('authorization')?.replace(/^Bearer\s+/i, '') ?? ''
    if (!d.peerSecret || !c.req.header(PEER_HOP_HEADER) || key.length !== d.peerSecret.length || !timingSafeEqual(Buffer.from(key), Buffer.from(d.peerSecret))) {
      return c.json({ error: 'NotFound' }, 404)
    }
    const did = c.req.query('did') ?? ''
    if (!d.users || !(await d.users.findByDid(did))) return c.json({ error: 'NotFound' }, 404)
    return c.json({ totp: !!(await d.mfa.get(did)).totpEnabledAt })
  })
}
