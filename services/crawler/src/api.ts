import { timingSafeEqual } from 'node:crypto'
import { Hono, type Context } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { getConnInfo } from '@hono/node-server/conninfo'
import { z } from 'zod'
import { PermanentError, type Crawler, type JobQueue } from './crawler.js'
import type { Repo } from './db.js'
import { PdsError } from './pds.js'

const CrawlBody = z.object({ url: z.string().trim().url().max(2000), crawler: z.string().min(1) })
const AccountBody = z.object({
  id: z.string().trim().toLowerCase(),
  site: z.string().trim().min(1).max(253),
  displayName: z.string().trim().min(1).max(64),
})
const SourceBody = z.object({ crawler: z.string().min(1), url: z.string().trim().url().max(2000), intervalMin: z.number().int().min(5).max(1440).default(30) })
const ToggleBody = z.object({ enabled: z.boolean() })

const safeEqual = (a: string, b: string) => {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  return ab.length === bb.length && timingSafeEqual(ab, bb)
}

export function createApi(d: {
  crawler: Crawler
  repo: Repo
  queue: JobQueue
  adminToken: string
  counts: () => Promise<unknown>
  /** сотрудник Zitadel с ролью admin */
  isStaffAdmin?: (token: string) => Promise<boolean>
}) {
  const app = new Hono().basePath('/crawler-api')

  app.onError((err, c) => {
    if (err instanceof PermanentError) return c.json({ error: 'InvalidRequest', message: err.message }, 400)
    if (err instanceof PdsError) return c.json({ error: err.code, message: err.message }, err.status === 400 ? 400 : 502)
    console.error(err)
    return c.json({ error: 'InternalServerError', message: 'Внутренняя ошибка краулера' }, 500)
  })

  // тела запросов маленькие (ссылка, id): больше 16 КБ — отказ
  app.use('*', bodyLimit({ maxSize: 16 * 1024, onError: (c) => c.json({ error: 'PayloadTooLarge', message: 'Слишком большое тело запроса' }, 413) }))

  app.get('/health', (c) => c.json({ ok: true }))

  // перебор токена: не больше AUTH_FAIL_MAX неудач с IP за минуту, дальше 429
  const AUTH_FAIL_MAX = 20
  const AUTH_WINDOW_MS = 60_000
  const authFails = new Map<string, { n: number; reset: number }>()
  const clientIp = (c: Context) => {
    try {
      return getConnInfo(c).remote.address ?? 'unknown'
    } catch {
      return 'unknown'
    }
  }

  // всё остальное — только админу
  app.use('*', async (c, next) => {
    const ip = clientIp(c)
    const now = Date.now()
    let f = authFails.get(ip)
    if (f && f.reset <= now) {
      authFails.delete(ip)
      f = undefined
    }
    if (f && f.n >= AUTH_FAIL_MAX) return c.json({ error: 'TooManyRequests', message: 'Слишком много неудачных попыток, подождите минуту' }, 429)
    const h = c.req.header('authorization') ?? ''
    const token = h.startsWith('Bearer ') ? h.slice(7) : ''
    const allowed = !!token && (safeEqual(token, d.adminToken) || (!!d.isStaffAdmin && (await d.isStaffAdmin(token))))
    if (!allowed) {
      if (f) f.n++
      else authFails.set(ip, { n: 1, reset: now + AUTH_WINDOW_MS })
      // не даём карте расти бесконечно
      if (authFails.size > 10_000) for (const [k, v] of authFails) if (v.reset <= now) authFails.delete(k)
      return c.json({ error: 'Forbidden', message: 'Нужен вход сотрудника с ролью admin' }, 403)
    }
    await next()
  })

  const body = async <T extends z.ZodType>(c: Context, schema: T): Promise<z.infer<T>> => {
    const r = schema.safeParse(await c.req.json().catch(() => null))
    if (!r.success) throw new PermanentError(z.prettifyError(r.error))
    return r.data
  }
  const publicAccount = (a: Awaited<ReturnType<Repo['accounts']['list']>>[number]) => ({
    id: a.id,
    handle: a.handle,
    did: a.did,
    displayName: a.display_name,
    site: a.site,
    enabled: a.enabled,
    createdAt: a.created_at,
  })

  app.get('/crawlers', async (c) => c.json((await d.repo.accounts.list()).map(publicAccount)))

  app.post('/crawlers', async (c) => c.json(publicAccount(await d.crawler.createAccount(await body(c, AccountBody))), 201))

  app.patch('/crawlers/:id', async (c) => {
    const { enabled } = await body(c, ToggleBody)
    await d.repo.accounts.setEnabled(c.req.param('id'), enabled)
    return c.json({ ok: true })
  })

  /** Админ присылает ссылку на конкретную статью и выбирает краулера */
  app.post('/crawl', async (c) => {
    const { url, crawler } = await body(c, CrawlBody)
    const r = await d.crawler.enqueue({ url, crawlerId: crawler, origin: 'manual', requestedBy: 'admin' })
    return c.json(r, r.duplicate ? 200 : 202)
  })

  app.get('/items', async (c) => {
    const limit = Math.min(200, Math.max(1, Number(c.req.query('limit')) || 50))
    return c.json(await d.repo.items.list(limit))
  })

  /** Повторить упавшую задачу */
  app.post('/items/:id/retry', async (c) => {
    const item = await d.repo.items.get(c.req.param('id'))
    if (!item) return c.json({ error: 'NotFound', message: 'Нет такой задачи' }, 404)
    if (item.status === 'published') return c.json({ error: 'InvalidRequest', message: 'Уже опубликовано' }, 400)
    await d.repo.items.update(item.id, { status: 'queued', error: null })
    await d.queue.addArticle(`${item.id}`)
    return c.json({ ok: true }, 202)
  })

  app.get('/sources', async (c) => c.json(await d.repo.sources.list()))

  app.post('/sources', async (c) => {
    const s = await body(c, SourceBody)
    return c.json(await d.crawler.addSource({ crawlerId: s.crawler, url: s.url, intervalMin: s.intervalMin }), 201)
  })

  app.post('/sources/:id/poll', async (c) => {
    await d.queue.addSourcePoll(c.req.param('id'))
    return c.json({ ok: true }, 202)
  })

  app.patch('/sources/:id', async (c) => {
    const { enabled } = await body(c, ToggleBody)
    const src = await d.repo.sources.get(c.req.param('id'))
    if (!src) return c.json({ error: 'NotFound', message: 'Нет такого источника' }, 404)
    await d.repo.sources.setEnabled(src.id, enabled)
    if (enabled) await d.queue.scheduleSource({ ...src, enabled })
    else await d.queue.unscheduleSource(src.id)
    return c.json({ ok: true })
  })

  app.delete('/sources/:id', async (c) => {
    await d.queue.unscheduleSource(c.req.param('id'))
    await d.repo.sources.remove(c.req.param('id'))
    return c.json({ ok: true })
  })

  app.get('/queues', async (c) => c.json(await d.counts()))

  return app
}
