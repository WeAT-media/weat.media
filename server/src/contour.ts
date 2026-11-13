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
  /** публичный адрес соседнего контура для переадресации пользователя */
  publicUrl: string
}

export const PEER_HOP_HEADER = 'x-indie-peer-hop'

export function createPeer(url: string, timeoutMs = 3000): PeerContour {
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
