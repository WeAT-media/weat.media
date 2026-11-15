import type { Context, Hono } from 'hono'
import type { PdsClient } from './pds.js'
import { ARTICLE_COLLECTION } from './paidContent.js'
import type { PendingSource } from './cooldown.js'
import { filterRssItems, rssGuids, type RestrictedFilter } from './restricted.js'

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
export function mountFeedRoutes(app: Hono, d: { pds: PdsClient; feedUrl?: string; restricted?: RestrictedFilter; moved?: (uris: string[]) => Promise<Map<string, string>>; pending?: PendingSource }) {
  // статьи в периоде охлаждения (24 ч до ухода в AT): на сайте — сразу, первой страницей «Свежего»
  const held = async (q: { author?: string; tags?: string; kind?: string }) => {
    if (!d.pending) return []
    const tags = q.tags?.split(',').filter(Boolean) ?? []
    return (await d.pending.list(ARTICLE_COLLECTION))
      .filter((r) => !q.author || r.did === q.author || r.handle === q.author)
      .filter((r) => !tags.length || tags.some((t) => ((r.record.tags as string[] | undefined) ?? []).includes(t)))
      .filter((r) => !q.kind || (q.kind === 'video' ? r.record.kind === 'video' : r.record.kind !== 'video'))
      .map(({ collection: _c, subject: _s, ...item }) => item)
  }
  /** РФ-контур: вырезать записи с метками nsfw/politics (restricted.ts) */
  // и перенесённые автору статьи краулера (claims.ts): оригинал из ленты уходит, в ней — копия автора
  const strip = async <T extends { uri: string }>(items: T[]): Promise<T[]> => {
    if (!items.length) return items
    const uris = items.map((i) => i.uri)
    const [blocked, moved] = await Promise.all([
      d.restricted?.enabled ? d.restricted.blocked(uris) : Promise.resolve(new Set<string>()),
      d.moved ? d.moved(uris).catch(() => new Map<string, string>()) : Promise.resolve(new Map<string, string>()),
    ])
    return blocked.size || moved.size ? items.filter((i) => !blocked.has(i.uri) && !moved.has(i.uri)) : items
  }
  const stripBody = async (body: unknown) => {
    const b = body as { articles?: { uri: string }[] }
    return Array.isArray(b?.articles) ? { ...b, articles: await strip(b.articles) } : body
  }
  const closed = async (uri: string) => !!d.restricted?.enabled && (await d.restricted.blocked([uri])).has(uri)
  const unavailable = { error: 'UnavailableInRegion', message: 'Материал недоступен в вашем регионе' }

  /** RSS сервиса ленты — через AppView, чтобы в РФ-контуре из него тоже ушли закрытые записи */
  const rss = async (c: Context) => {
    if (!d.feedUrl) return c.text('not found', 404)
    const path = c.req.path.replace(/^\/api/, '')
    const res = await fetch(`${d.feedUrl}${path}${new URL(c.req.url).search}`, { signal: AbortSignal.timeout(5000) }).catch(() => null)
    if (!res) return c.text('feed unavailable', 502)
    const xml = await res.text()
    const out = d.restricted?.enabled ? filterRssItems(xml, await d.restricted.blocked(rssGuids(xml))) : xml
    return c.body(out, res.status as 200, { 'content-type': res.headers.get('content-type') ?? 'application/rss+xml; charset=utf-8', 'cache-control': 'public, max-age=300' })
  }
  app.get('/rss/author/:handle', rss)
  app.get('/rss/comments/:did/:rkey', rss)

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
    return c.json(await stripBody(await res.json()))
  })

  app.get('/feed/article', async (c) => {
    let uri = c.req.query('uri') ?? ''
    if (!/^at:\/\/did:[a-z]+:[A-Za-z0-9._:%-]+\/media\.weat\.article\/[A-Za-z0-9._~:-]+$/.test(uri)) {
      return c.json({ error: 'InvalidRequest', message: 'uri: at://did/media.weat.article/rkey' }, 400)
    }
    // перенесённая автору статья краулера: по старому адресу — копия автора
    const movedTo = d.moved ? (await d.moved([uri]).catch(() => new Map<string, string>())).get(uri) : undefined
    if (movedTo) uri = movedTo
    if (await closed(uri)) return c.json(unavailable, 451)
    // в охлаждении (своём или соседнего контура) — ещё не в индексе ленты
    const held = d.pending ? await d.pending.get(uri) : undefined
    if (held) {
      c.header('cache-control', 'no-store')
      const { collection: _c, subject: _s, ...item } = held
      return c.json({ ...item, textLength: String(item.record.text ?? '').length })
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
          const body = (await stripBody(await res.json())) as { articles?: { uri: string }[] }
          // первая страница «Свежего» без фильтров по источнику — с ждущими статьями сверху
          const sort = c.req.query('sort')
          if (body.articles && !c.req.query('cursor') && (!sort || sort === 'new') && !c.req.query('source') && !c.req.query('view') && !c.req.query('lang')) {
            const seen = new Set(body.articles.map((a) => a.uri))
            const extra = (await held({ author: c.req.query('author'), tags: c.req.query('tags'), kind: c.req.query('kind') })).filter((a) => !seen.has(a.uri))
            body.articles = [...(await strip(extra)), ...body.articles]
          }
          return c.json(body)
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
    return c.json({ articles: await strip(cache.items.slice(0, limit)) })
  })
}
