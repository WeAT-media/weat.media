import type { Context, Hono } from 'hono'
import type { UserRepo } from './db.js'

/**
 * Связка двух контуров одного ресурса. Handle у всех вида alina.indie.media, а
 * аккаунт (и персональные данные) живёт в одном контуре. Соседний контур спрашиваем
 * по HTTP — базы контуров не связаны, через границу идёт только публичная пара handle -> DID.
 */
export interface PeerContour {
  /** DID пользователя соседнего контура или null; бросает, если сосед недоступен */
  resolve(handle: string): Promise<string | null>
  /**
   * публичный профиль из соседнего контура (по handle или DID) или null — для страницы профиля.
   * Через границу — только то, что пользователь сам опубликовал (handle, DID, имя, дата, служебная ли учётка):
   * без email, стран и тарифа (152-ФЗ). Ответ не сохраняется — только показывается.
   */
  profile(id: string): Promise<PeerProfile | null>
  /** публичный адрес соседнего контура для переадресации пользователя */
  publicUrl: string
  /**
   * Вход через провайдера (Яндекс…), когда в этом контуре привязки нет: аккаунт может жить у соседа —
   * он выдаёт одноразовый код входа (/login?handoff=…) на своём адресе. null — у соседа такого аккаунта нет.
   * Передаётся только провайдер, id аккаунта у провайдера и страна входа — без email и имени.
   */
  oauthLogin?(provider: string, providerUserId: string, country: string): Promise<string | null>
}

export const PEER_HOP_HEADER = 'x-indie-peer-hop'

export interface PeerProfile {
  did: string
  handle: string
  displayName: string | null
  createdAt: string
  service: string | null
}

/** что отдаём соседнему контуру о своём пользователе: только опубликованное им самим */
export function peerProfile(u: { did: string; handle: string; display_name: string | null; created_at: Date; service?: string | null }): PeerProfile {
  return { did: u.did, handle: u.handle, displayName: u.display_name, createdAt: u.created_at.toISOString(), service: u.service ?? null }
}

export function createPeer(url: string, timeoutMs = 3000, secret?: string): PeerContour {
  return {
    publicUrl: url.replace(/\/$/, ''),
    async resolve(handle) {
      const ctrl = new AbortController()
      const t = setTimeout(() => ctrl.abort(), timeoutMs)
      try {
        const res = await fetch(`${url.replace(/\/$/, '')}/api/handles/resolve?${new URLSearchParams({ handle })}`, {
          headers: { [PEER_HOP_HEADER]: '1' },
          signal: ctrl.signal,
        })
        if (res.status === 404) return null
        if (!res.ok) throw new Error(`peer ${res.status}`)
        const did = (await res.text()).trim()
        return /^did:[a-z]+:[A-Za-z0-9._:%-]+$/.test(did) ? did : null
      } finally {
        clearTimeout(t)
      }
    },
    ...(secret
      ? {
          async oauthLogin(provider: string, providerUserId: string, country: string) {
            const res = await fetch(`${url.replace(/\/$/, '')}/api/peer/oauth-login`, {
              method: 'POST',
              headers: { [PEER_HOP_HEADER]: '1', authorization: `Bearer ${secret}`, 'content-type': 'application/json' },
              body: JSON.stringify({ provider, providerUserId, country }),
              signal: AbortSignal.timeout(timeoutMs),
            }).catch(() => null)
            if (!res?.ok) return null
            const b = (await res.json().catch(() => null)) as { code?: unknown } | null
            return typeof b?.code === 'string' ? b.code : null
          },
        }
      : {}),
    async profile(id) {
      const res = await fetch(`${url.replace(/\/$/, '')}/api/peer/users/${encodeURIComponent(id)}`, {
        headers: { [PEER_HOP_HEADER]: '1' },
        signal: AbortSignal.timeout(timeoutMs),
      }).catch(() => null)
      if (!res?.ok) return null
      const p = (await res.json().catch(() => null)) as PeerProfile | null
      return p && /^did:[a-z]+:/.test(p.did) && HANDLE.test(p.handle) ? p : null
    },
  }
}

const HANDLE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/

export function mountContourRoutes(app: Hono, d: { users: UserRepo; peer?: PeerContour; nodeRole: 'primary' | 'standby' }) {
  // standby не обслуживает запросы: запись в две базы контура (split-brain) недопустима
  if (d.nodeRole === 'standby') {
    app.use('*', async (c, next) => {
      if (c.req.path === '/api/health') return next()
      return c.json({ error: 'Standby', message: 'Узел в резерве. Обслуживает основной узел контура.' }, 503)
    })
  }

  /**
   * alina.indie.media/.well-known/atproto-did -> DID (Caddy переписывает путь сюда).
   * Handle берём из ?handle= (запрос соседа) или из Host.
   */
  /** соседнему контуру — публичный профиль своего пользователя (без персональных полей) */
  app.get('/peer/users/:id', async (c) => {
    if (!c.req.header(PEER_HOP_HEADER)) return c.json({ error: 'NotFound' }, 404)
    const u = await d.users.findByHandleOrDid(c.req.param('id').toLowerCase())
    if (!u) return c.json({ error: 'NotFound' }, 404)
    c.header('cache-control', 'public, max-age=300')
    return c.json(peerProfile(u))
  })

  app.get('/handles/resolve', async (c: Context) => {
    const raw = (c.req.query('handle') ?? c.req.header('x-forwarded-host') ?? c.req.header('host') ?? '').toLowerCase()
    const handle = raw.split(':')[0]!
    if (!HANDLE.test(handle)) return c.text('invalid handle', 400)
    const local = await d.users.findByHandleOrDid(handle)
    if (local) return c.text(local.did, 200, { 'cache-control': 'public, max-age=300' })
    // к соседу — только из внешнего запроса, иначе два контура спрашивали бы друг друга по кругу
    if (d.peer && !c.req.header(PEER_HOP_HEADER)) {
      const did = await d.peer.resolve(handle).catch(() => null)
      if (did) return c.text(did, 200, { 'cache-control': 'public, max-age=300' })
    }
    return c.text('not found', 404)
  })
}
