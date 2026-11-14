import { randomBytes } from 'node:crypto'
import type { Context, Hono, MiddlewareHandler } from 'hono'
import type { Sql } from './db.js'
import { PdsError, type PdsClient } from './pds.js'
import type { Staff, StaffRole } from './staff.js'
import { tokenHash } from './securityRoutes.js'
import type { SecretBox } from './secretbox.js'

/**
 * Журнал устройств. Каждая пара токенов, которую выдаёт сервер (вход, регистрация, OAuth, второй фактор,
 * обновление), — сессия; при обновлении — та же сессия с новыми хешами. Пользователь видит свои устройства
 * в «Безопасности», сотрудник — в /admin/users; оба могут завершить.
 *
 * Завершение сессии отзывает её и в PDS (deleteSession по сохранённому зашифрованному refresh): новую пару
 * из неё не получить ни через сайт, ни напрямую. Уже выданный access-токен PDS живёт до своих 2 часов —
 * через сайт он не пройдёт сразу (журнал), напрямую к PDS — до истечения; оборвать сразу всё — смена пароля.
 */

export interface SessionRow {
  id: string
  did: string
  access_hash: string
  refresh_hash: string
  device: string
  country: string
  created_at: Date
  last_seen_at: Date
  revoked_at: Date | null
  revoked_by: string | null
  /** refresh-токен PDS, зашифрованный SECRETS_KEY — для отзыва в PDS */
  refresh_enc: string | null
}

export interface SessionRepo {
  /** новая сессия или ротация: prevRefreshHash — refresh, которым обновились */
  record(s: { did: string; accessHash: string; refreshHash: string; refreshEnc?: string; device: string; country: string; prevRefreshHash?: string }): Promise<void>
  /** токен (access или refresh) завершённой сессии */
  isRevoked(hash: string): Promise<boolean>
  byAccess(hash: string): Promise<SessionRow | undefined>
  list(did: string, limit: number): Promise<SessionRow[]>
  /** ids — какие завершить; null — все активные аккаунта; keep — кроме этой. refresh — зашифрованные refresh отозванных (для PDS) */
  revoke(did: string, ids: string[] | null, by: string, keep?: string): Promise<{ count: number; refresh: string[] }>
}

export function sessionRepo(sql: Sql): SessionRepo {
  return {
    async record(s) {
      if (s.prevRefreshHash) {
        const rows = await sql`
          UPDATE user_sessions SET access_hash = ${s.accessHash}, refresh_hash = ${s.refreshHash}, refresh_enc = ${s.refreshEnc ?? null}, last_seen_at = now(), country = ${s.country}
          WHERE refresh_hash = ${s.prevRefreshHash} AND revoked_at IS NULL RETURNING id`
        if (rows.length) return
      }
      await sql`
        INSERT INTO user_sessions (id, did, access_hash, refresh_hash, refresh_enc, device, country)
        VALUES (${newId()}, ${s.did}, ${s.accessHash}, ${s.refreshHash}, ${s.refreshEnc ?? null}, ${s.device}, ${s.country})`
    },
    // у access-токена PDS нет уникального номера: два входа в одну секунду дают один и тот же токен.
    // Поэтому отозван — только если отозваны все сессии с этим хешем
    async isRevoked(hash) {
      const [r] = await sql<{ revoked: boolean | null }[]>`
        SELECT bool_and(revoked_at IS NOT NULL) AS revoked FROM user_sessions WHERE access_hash = ${hash} OR refresh_hash = ${hash}`
      return r?.revoked === true
    },
    async byAccess(hash) {
      const [r] = await sql<SessionRow[]>`SELECT * FROM user_sessions WHERE access_hash = ${hash} ORDER BY revoked_at IS NOT NULL, last_seen_at DESC LIMIT 1`
      return r
    },
    list(did, limit) {
      return sql<SessionRow[]>`SELECT * FROM user_sessions WHERE did = ${did} ORDER BY revoked_at IS NOT NULL, last_seen_at DESC LIMIT ${limit}`
    },
    async revoke(did, ids, by, keep) {
      // refresh_enc после отзыва больше не нужен: возвращаем для deleteSession и стираем
      const rows = ids
        ? await sql<{ enc: string | null }[]>`UPDATE user_sessions u SET revoked_at = now(), revoked_by = ${by}, refresh_enc = NULL
            FROM (SELECT id, refresh_enc AS enc FROM user_sessions WHERE did = ${did} AND id = ANY(${ids}) AND revoked_at IS NULL FOR UPDATE) o
            WHERE u.id = o.id RETURNING o.enc`
        : await sql<{ enc: string | null }[]>`UPDATE user_sessions u SET revoked_at = now(), revoked_by = ${by}, refresh_enc = NULL
            FROM (SELECT id, refresh_enc AS enc FROM user_sessions WHERE did = ${did} AND revoked_at IS NULL AND id <> ${keep ?? ''} FOR UPDATE) o
            WHERE u.id = o.id RETURNING o.enc`
      return { count: rows.length, refresh: rows.map((r) => r.enc).filter((e): e is string => !!e) }
    },
  }
}

const newId = () => `ses_${randomBytes(8).toString('base64url')}`

/** «Safari · macOS» по User-Agent — грубо, но человеку узнать своё устройство хватает */
export function deviceLabel(ua: string): string {
  const os = /iPhone|iPad|iOS/.test(ua)
    ? 'iOS'
    : /Android/.test(ua)
      ? 'Android'
      : /Mac OS X|Macintosh/.test(ua)
        ? 'macOS'
        : /Windows/.test(ua)
          ? 'Windows'
          : /Linux/.test(ua)
            ? 'Linux'
            : null
  const browser = /YaBrowser/.test(ua)
    ? 'Яндекс Браузер'
    : /Edg\//.test(ua)
      ? 'Edge'
      : /OPR\/|Opera/.test(ua)
        ? 'Opera'
        : /Firefox\//.test(ua)
          ? 'Firefox'
          : /Chrome\//.test(ua)
            ? 'Chrome'
            : /Safari\//.test(ua)
              ? 'Safari'
              : null
  if (!os && !browser) return ua ? 'Другое устройство' : 'Неизвестное устройство'
  return [browser, os].filter(Boolean).join(' · ')
}

const fail = (code: string, message: string, status: 400 | 401 | 404) => new PdsError(status, code, message)

/**
 * До маршрутов: токен завершённой сессии — 401 сразу (и refresh в /auth/refresh тоже).
 * После: если ответ выдал пару токенов — записать сессию (при обновлении — перенести на новые токены).
 */
export function sessionTracking(d: { sessions: SessionRepo; secrets: SecretBox }, h: { bearer(c: Context): string | undefined; country(c: Context): string }): MiddlewareHandler {
  return async (c, next) => {
    const bearer = h.bearer(c)
    const isRefresh = c.req.method === 'POST' && c.req.path.endsWith('/auth/refresh')
    const prevRefresh = isRefresh ? ((await c.req.raw.clone().json().catch(() => null)) as { refreshJwt?: string } | null)?.refreshJwt : undefined
    // любой bearer: токен сотрудника (Zitadel) и персональный wm_pat_ в журнале просто не найдутся
    const checked = bearer ?? prevRefresh
    if (checked && (await d.sessions.isRevoked(tokenHash(checked)))) {
      return c.json({ error: 'SessionRevoked', message: 'Сессия завершена — войдите снова' }, 401)
    }
    await next()
    if (c.res.status >= 300 || !c.res.headers.get('content-type')?.includes('application/json')) return
    const body = (await c.res.clone().json().catch(() => null)) as { accessJwt?: string; refreshJwt?: string; user?: { did?: string } } | null
    if (!body?.accessJwt || !body.refreshJwt || !body.user?.did) return
    await d.sessions.record({
      did: body.user.did,
      accessHash: tokenHash(body.accessJwt),
      refreshHash: tokenHash(body.refreshJwt),
      refreshEnc: d.secrets.seal(body.refreshJwt),
      device: deviceLabel(c.req.header('user-agent') ?? ''),
      country: h.country(c),
      ...(prevRefresh ? { prevRefreshHash: tokenHash(prevRefresh) } : {}),
    })
  }
}

const dto = (s: SessionRow, current?: string) => ({
  id: s.id,
  device: s.device,
  country: s.country,
  createdAt: s.created_at.toISOString(),
  lastSeenAt: s.last_seen_at.toISOString(),
  revokedAt: s.revoked_at?.toISOString() ?? null,
  current: s.id === current,
})

export function mountSessionRoutes(
  app: Hono,
  d: { pds: PdsClient; sessions: SessionRepo; secrets: SecretBox },
  h: {
    bearer(c: Context): string | undefined
    requireStaff(c: Context, role: StaffRole): Promise<Staff | 'break-glass'>
    audit(who: Staff | 'break-glass', action: string, target: string | null, details?: Record<string, unknown>): Promise<void>
  },
) {
  const me = async (c: Context) => {
    const token = h.bearer(c)
    if (!token) throw fail('AuthenticationRequired', 'Нужно войти', 401)
    const { did } = await d.pds.getSession(token)
    return { did, current: (await d.sessions.byAccess(tokenHash(token)))?.id }
  }

  /** отозвать в AppView, затем в PDS: refresh отозванных сессий больше не обновится нигде */
  const revoke = async (did: string, ids: string[] | null, by: string, keep?: string) => {
    const r = await d.sessions.revoke(did, ids, by, keep)
    await Promise.all(
      r.refresh.map(async (enc) => {
        try {
          await d.pds.deleteSession(d.secrets.open(enc))
        } catch {
          // уже истёк или отозван сменой пароля — на стороне PDS сессии и так нет
        }
      }),
    )
    return r.count
  }

  app.get('/me/sessions', async (c) => {
    const { did, current } = await me(c)
    c.header('cache-control', 'private, no-store')
    return c.json((await d.sessions.list(did, 50)).map((s) => dto(s, current)))
  })

  app.delete('/me/sessions/:id', async (c) => {
    const { did } = await me(c)
    const n = await revoke(did, [c.req.param('id')], 'user')
    if (!n) throw fail('NotFound', 'Сессия не найдена или уже завершена', 404)
    return c.json({ ok: true })
  })

  /** «Завершить все, кроме этого устройства» */
  app.post('/me/sessions/revoke-others', async (c) => {
    const { did, current } = await me(c)
    return c.json({ ok: true, revoked: await revoke(did, null, 'user', current) })
  })

  app.get('/admin/users/:did/sessions', async (c) => {
    await h.requireStaff(c, 'support')
    c.header('cache-control', 'private, no-store')
    return c.json((await d.sessions.list(c.req.param('did'), 100)).map((s) => dto(s)))
  })

  app.delete('/admin/users/:did/sessions/:id', async (c) => {
    const staff = await h.requireStaff(c, 'support')
    const did = c.req.param('did')
    const n = await revoke(did, [c.req.param('id')], staff === 'break-glass' ? 'break-glass' : staff.sub)
    if (!n) throw fail('NotFound', 'Сессия не найдена или уже завершена', 404)
    await h.audit(staff, 'session.revoke', did, { session: c.req.param('id') })
    return c.json({ ok: true })
  })

  app.post('/admin/users/:did/sessions/revoke-all', async (c) => {
    const staff = await h.requireStaff(c, 'support')
    const did = c.req.param('did')
    const revoked = await revoke(did, null, staff === 'break-glass' ? 'break-glass' : staff.sub)
    await h.audit(staff, 'session.revoke_all', did, { revoked })
    return c.json({ ok: true, revoked })
  })
}
