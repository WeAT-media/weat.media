import { timingSafeEqual } from 'node:crypto'
import type { Hono } from 'hono'
import { cors } from 'hono/cors'
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

export function mountPdsGate(app: Hono, d: { pdsUrl?: string; pdsHost?: string; pds: PdsClient; mfa: MfaRepo; peer?: PeerContour; users?: UserRepo; peerSecret?: string }) {
  // Публичный XRPC для AT-клиентов: как и у исходного PDS, Origin может быть любым (bsky.app и др.).
  app.use('/pds/createSession', cors({ origin: '*', allowHeaders: ['content-type', 'authorization'] }))
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
