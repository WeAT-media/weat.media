import type { Hono } from 'hono'
import type { MfaRepo } from './db.js'
import type { PdsClient } from './pds.js'

/**
 * Вход в PDS снаружи (com.atproto.server.createSession на pds.weat.media) идёт через AppView:
 * Caddy переписывает его сюда. TOTP живёт в AppView, а PDS о нём не знает — без этой проверки
 * утёкший пароль давал бы полный доступ к репозиторию в обход второго фактора.
 *
 *   аккаунт без TOTP          — ответ PDS как есть (клиенты AT, Bluesky и др. работают)
 *   с TOTP, пароль приложения — как есть: app password в AT и есть способ входа сторонних клиентов
 *   с TOTP, основной пароль   — полную сессию сразу отзываем, 401 AuthFactorTokenRequired
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

export function mountPdsGate(app: Hono, d: { pdsUrl?: string; pds: PdsClient; mfa: MfaRepo }) {
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
}
