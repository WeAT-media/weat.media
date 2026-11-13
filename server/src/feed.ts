import type { Hono } from 'hono'
import type { PdsClient } from './pds.js'
import { ARTICLE_COLLECTION } from './paidContent.js'

/**
 * Временная лента: статьи со своего PDS (пользователи и краулеры) без индексатора сети.
 * Опрос репозиториев дорогой, поэтому результат кэшируется на CACHE_MS.
 * Заменится сервисом ленты (firehose → индекс), API останется тем же.
 */

export interface FeedItem {
  uri: string
  cid: string
  did: string
  handle: string
  record: Record<string, unknown>
}

const CACHE_MS = 30_000
const PER_REPO = 50
const MAX_REPOS = 500

/** feedUrl — сервис ленты (services/feed); недоступен — временный обход PDS */
export function mountFeedRoutes(app: Hono, d: { pds: PdsClient; feedUrl?: string }) {
  let cache: { at: number; items: FeedItem[] } | null = null
  let inflight: Promise<FeedItem[]> | null = null
  const handles = new Map<string, string>()

  const build = async (): Promise<FeedItem[]> => {
    const dids: string[] = []
    let cursor: string | undefined
    do {
      const page = await d.pds.listRepos(100, cursor)
      for (const r of page.repos) if (r.active !== false) dids.push(r.did)
      cursor = page.cursor
    } while (cursor && dids.length < MAX_REPOS)

    const items: FeedItem[] = []
    await Promise.all(
      dids.map(async (did) => {
        const recs = await d.pds.listRecords(did, ARTICLE_COLLECTION, PER_REPO).catch(() => ({ records: [] }))
        if (!recs.records.length) return
        let handle = handles.get(did)
        if (!handle) {
          handle = await d.pds.describeRepo(did).then((r) => r.handle, () => did)
          handles.set(did, handle)
        }
        for (const r of recs.records) items.push({ uri: r.uri, cid: r.cid, did, handle, record: r.value })
      }),
    )
    const at = (i: FeedItem) => String(i.record.createdAt ?? '')
    return items.sort((a, b) => at(b).localeCompare(at(a)))
  }

  /** одна статья целиком (лента отдаёт карточки без текста) */
  /** «Читать дальше»: общие теги и общие читатели — считает индекс (services/feed/src/rank.rs) */
  app.get('/feed/related', async (c) => {
    const uri = c.req.query('uri') ?? ''
    if (!/^at:\/\/did:[a-z]+:[A-Za-z0-9._:%-]+\/media\.weat\.article\/[A-Za-z0-9._~:-]+$/.test(uri)) {
      return c.json({ error: 'InvalidRequest', message: 'uri: at://did/media.weat.article/rkey' }, 400)
    }
    const limit = String(Math.min(20, Math.max(1, Number(c.req.query('limit')) || 3)))
    const kind = c.req.query('kind')
    if (!d.feedUrl) return c.json({ articles: [] })
    const q = new URLSearchParams({ uri, limit, ...(kind === 'video' || kind === 'text' ? { kind } : {}) })
    const res = await fetch(`${d.feedUrl}/feed-api/related?${q}`, { signal: AbortSignal.timeout(3000) }).catch(() => null)
    // рекомендации — не главное на странице: индекс недоступен — пустой блок, а не ошибка
    if (!res?.ok) return c.json({ articles: [] })
    c.header('cache-control', 'public, max-age=60')
    return c.json(await res.json())
  })

  app.get('/feed/article', async (c) => {
    const uri = c.req.query('uri') ?? ''
    if (!/^at:\/\/did:[a-z]+:[A-Za-z0-9._:%-]+\/media\.weat\.article\/[A-Za-z0-9._~:-]+$/.test(uri)) {
      return c.json({ error: 'InvalidRequest', message: 'uri: at://did/media.weat.article/rkey' }, 400)
    }
    if (d.feedUrl) {
      const res = await fetch(`${d.feedUrl}/feed-api/article?${new URLSearchParams({ uri })}`, { signal: AbortSignal.timeout(3000) }).catch(() => null)
      if (res?.ok) {
        c.header('cache-control', 'public, max-age=30')
        return c.json(await res.json())
      }
      if (res?.status === 404) return c.json({ error: 'NotFound', message: 'Статья не найдена' }, 404)
    }
    // запасной путь — прямо из репозитория автора
    const [, , did = '', , rkey = ''] = uri.split('/')
    const record = await d.pds.getRecord(did, ARTICLE_COLLECTION, rkey).catch(() => undefined)
    if (!record) return c.json({ error: 'NotFound', message: 'Статья не найдена' }, 404)
    const handle = await d.pds.describeRepo(did).then((r) => r.handle, () => did)
    return c.json({ uri, cid: '', did, handle, record, textLength: String(record.text ?? '').length })
  })

  app.get('/feed', async (c) => {
    const limit = Math.min(200, Math.max(1, Number(c.req.query('limit')) || 100))
    if (d.feedUrl) {
      // фильтры и курсор — как есть; ответ той же формы { articles, cursor }
      const q = new URLSearchParams()
      for (const k of ['cursor', 'tags', 'lang', 'source', 'author', 'view', 'sort', 'metric', 'period', 'kind']) {
        const v = c.req.query(k)
        if (v) q.set(k, v)
      }
      q.set('limit', String(Math.min(limit, 100)))
      try {
        const res = await fetch(`${d.feedUrl}/feed-api/articles?${q}`, { signal: AbortSignal.timeout(3000) })
        if (res.ok) {
          c.header('cache-control', 'public, max-age=5')
          return c.json(await res.json())
        }
        // ошибка запроса (неверный sort, курсор) — отдаём как есть: обход PDS её только спрятал бы
        if (res.status >= 400 && res.status < 500) return c.json(await res.json().catch(() => ({ error: 'InvalidRequest' })), res.status as 400)
      } catch (err) {
        console.warn('feed service unavailable, falling back to PDS scan', err instanceof Error ? err.message : err)
      }
    }
    if (!cache || Date.now() - cache.at > CACHE_MS) {
      // один опрос на всех: параллельные запросы ждут его
      inflight ??= build().finally(() => (inflight = null))
      cache = { at: Date.now(), items: await inflight }
    }
    c.header('cache-control', 'public, max-age=30')
    return c.json({ articles: cache.items.slice(0, limit) })
  })
}
