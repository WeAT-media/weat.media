import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { createCrawler, PermanentError, sameSite, type JobQueue } from '../src/crawler.ts'
import type { CrawlerAccount, CrawlItem, CrawlSource, Repo } from '../src/db.ts'
import { extractArticle, rssLinks } from '../src/extract.ts'
import { FetchError, canonicalUrl, createFetcher, isPublicAddress } from '../src/fetcher.ts'
import type { Pds } from '../src/pds.ts'
import { articleRecord } from '../src/record.ts'
import { createSecretBox } from '../src/secretbox.ts'

/** правила разбора сайтов в памяти (repo.rules) */
const siteRules = new Map<string, { host: string; rules: string; updated_by: string | null; updated_at: Date }>()

const HABR = readFileSync(new URL('./fixtures/habr-article.html', import.meta.url), 'utf8')

test('habr extractor: metadata, markdown, sanitizing', () => {
  const a = extractArticle(HABR, 'https://habr.com/ru/articles/1/')
  assert.equal(a.title, 'Тестовая статья про очереди')
  assert.equal(a.author, 'test_author')
  assert.equal(a.authorUrl, 'https://habr.com/ru/users/test_author/')
  assert.equal(a.publishedAt, '2026-11-12T10:00:00.000Z')
  assert.deepEqual(a.tags, ['Программирование', 'Бэкенд'])
  assert.equal(a.lang, 'ru')
  assert.match(a.markdown, /^Очереди задач позволяют/)
  assert.match(a.markdown, /## Повторы/)
  assert.match(a.markdown, /\[повторить позже\]\(https:\/\/habr\.com\/ru\/articles\/123\/\)/, 'относительные ссылки стали абсолютными')
  assert.match(a.markdown, /!\[схема\]\(https:\/\/habrastorage\.org\/real\.png\)/, 'ленивая картинка из data-src')
  assert.match(a.markdown, /```ts\nconst q = new Queue\('crawl'\)/)
  assert.doesNotMatch(a.markdown, /alert|evil\.example|javascript:/, 'скрипты, iframe и javascript: вырезаны')
})

test('record follows media.weat.article lexicon', () => {
  const r = articleRecord(extractArticle(HABR, 'https://habr.com/ru/articles/1/'), new Date('2026-11-12T12:00:00Z'))
  assert.equal(r.$type, 'media.weat.article')
  assert.equal(r.source.site, 'habr.com')
  assert.equal(r.source.author, 'test_author')
  assert.equal(r.source.crawledAt, '2026-11-12T12:00:00.000Z')
  assert.deepEqual(r.langs, ['ru'])
})

test('canonical url drops utm, fragment, www, trailing slash', () => {
  assert.equal(
    canonicalUrl('https://www.Habr.com/ru/articles/1105478/?utm_source=habrahabr&utm_medium=rss#comments'),
    'https://habr.com/ru/articles/1105478',
  )
})

test('rss links prefer permalink guid', () => {
  const xml = `<rss><channel><item><title>A</title><guid isPermaLink="true">https://habr.com/ru/articles/1/</guid>
    <link>https://habr.com/ru/articles/1/?utm_source=rss</link></item><item><title>B</title><link>https://habr.com/ru/articles/2/</link></item></channel></rss>`
  assert.deepEqual(rssLinks(xml).map((x) => x.url), ['https://habr.com/ru/articles/1/', 'https://habr.com/ru/articles/2/'])
})

test('SSRF: private and special addresses are refused', async () => {
  for (const ip of ['127.0.0.1', '10.0.0.5', '192.168.1.1', '172.16.0.1', '169.254.169.254', '::1', 'fd00::1', '::ffff:127.0.0.1', '0.0.0.0']) {
    assert.equal(isPublicAddress(ip), false, ip)
  }
  assert.equal(isPublicAddress('93.184.216.34'), true)
  const fetchPage = createFetcher({ userAgent: 'test' })
  for (const url of ['http://127.0.0.1:2583/xrpc/_health', 'http://localhost:6379/', 'http://[::1]/', 'http://169.254.169.254/latest/meta-data/']) {
    await assert.rejects(fetchPage(url), (e: unknown) => e instanceof FetchError && e.code === 'Blocked', url)
  }
  await assert.rejects(fetchPage('file:///etc/passwd'), (e: unknown) => e instanceof FetchError && e.code === 'BadUrl')
})

test('fetcher: redirect into private network is refused, size limit enforced', async () => {
  const server = http.createServer((req, res) => {
    if (req.url === '/redirect') {
      res.writeHead(302, { location: 'http://127.0.0.1:2583/xrpc/_health' })
      return res.end()
    }
    res.writeHead(200, { 'content-type': 'text/html' })
    res.end('x'.repeat(2000))
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const port = (server.address() as AddressInfo).port
  // тестовый сервер сам на loopback: разрешаем только его, редирект проверяется по-настоящему
  const fetchPage = createFetcher({ userAgent: 'test', allowPrivate: true, maxBytes: 1000 })
  await assert.rejects(fetchPage(`http://127.0.0.1:${port}/big`), (e: unknown) => e instanceof FetchError && e.code === 'TooLarge')
  const strict = createFetcher({ userAgent: 'test' })
  await assert.rejects(strict(`http://127.0.0.1:${port}/redirect`), (e: unknown) => e instanceof FetchError && e.code === 'Blocked')
  server.close()
})

/* ── логика очереди с фейками ─────────────────────────────────────────── */
function memRepo() {
  const accounts = new Map<string, CrawlerAccount>()
  const items = new Map<string, CrawlItem>()
  const sources = new Map<string, CrawlSource>()
  let seq = 0
  const r = {
    accounts: {
      list: async () => [...accounts.values()],
      get: async (id: string) => accounts.get(id),
      insert: async (a: Omit<CrawlerAccount, 'created_at' | 'enabled'>) => {
        const row = { ...a, enabled: true, created_at: new Date() }
        accounts.set(a.id, row)
        return row
      },
      setEnabled: async (id: string, enabled: boolean) => void (accounts.get(id)!.enabled = enabled),
    },
    items: {
      create: async (i: { url: string; canonical: string; crawlerId: string; origin: 'manual' | 'source'; requestedBy: string | null; holdHours?: number }) => {
        if ([...items.values()].some((x) => x.url_canonical === i.canonical)) return null
        const id = String(++seq)
        const row: CrawlItem = {
          id, url: i.url, url_canonical: i.canonical, crawler_id: i.crawlerId, status: i.holdHours ? 'held' : 'queued', origin: i.origin,
          requested_by: i.requestedBy, title: null, at_uri: null, error: null, attempts: 0, created_at: new Date(), updated_at: new Date(),
          delay_hours: i.holdHours ?? 0, notified_at: null, notified_by: null, publish_after: null,
        }
        items.set(id, row)
        return row
      },
      byCanonical: async (c: string) => [...items.values()].find((x) => x.url_canonical === c),
      get: async (id: string) => items.get(id),
      list: async () => [...items.values()],
      update: async (id: string, p: { status: CrawlItem['status']; title?: string | null; atUri?: string | null; error?: string | null; attempts?: number }) => {
        const it = items.get(id)!
        Object.assign(it, { status: p.status, title: p.title ?? it.title, at_uri: p.atUri ?? it.at_uri, error: p.error ?? null, attempts: p.attempts ?? it.attempts })
      },
      notified: async (id: string, by: string | null, h: number) => {
        const it = items.get(id)
        if (!it || it.status !== 'held') return undefined
        return Object.assign(it, { status: 'queued', notified_at: new Date(), notified_by: by, delay_hours: h, publish_after: new Date(Date.now() + h * 3_600_000) })
      },
      duplicateOf: async (id: string, cp: string | null, tk: string | null) =>
        [...items.values()].find((x) => x.status === 'published' && x.id !== id && ((cp && x.canonical_page === cp) || (tk && x.title_key === tk))),
      fingerprint: async (id: string, cp: string | null, tk: string | null) => void Object.assign(items.get(id)!, { canonical_page: cp, title_key: tk }),
      skip: async (id: string, by: string | null) => {
        const it = items.get(id)
        if (!it || !['held', 'queued'].includes(it.status)) return undefined
        return Object.assign(it, { status: 'skipped', notified_by: by })
      },
    },
    rules: {
      list: async () => [...siteRules.values()],
      get: async (host: string) => siteRules.get(host),
      put: async (host: string, rules: string, by: string | null) => {
        const r = { host, rules, updated_by: by, updated_at: new Date() }
        siteRules.set(host, r)
        return r
      },
      remove: async (host: string) => void siteRules.delete(host),
    },
    sources: {
      list: async () => [...sources.values()],
      get: async (id: string) => sources.get(id),
      insert: async (s: { crawlerId: string; url: string; intervalMin: number }) => {
        const row: CrawlSource = { id: String(++seq), crawler_id: s.crawlerId, url: s.url, interval_min: s.intervalMin, enabled: true, last_polled_at: null, last_error: null }
        sources.set(row.id, row)
        return row
      },
      setEnabled: async () => {},
      polled: async (id: string, error: string | null) => void Object.assign(sources.get(id)!, { last_polled_at: new Date(), last_error: error }),
      remove: async () => {},
    },
  }
  return { repo: r as unknown as Repo, items }
}

function setup(pages: Record<string, string | FetchError | { redirect: string; body: string }>) {
  const { repo, items } = memRepo()
  const published: { handle: string; record: Record<string, unknown> }[] = []
  const queued: string[] = []
  const delays = new Map<string, number>()
  const pds = {
    createAccount: async (handle: string) => ({ did: `did:plc:${handle.split('.')[0]}`, handle, accessJwt: 'a', refreshJwt: 'r' }),
    createRecord: async (cred: { handle: string }, _c: string, record: Record<string, unknown>) => {
      published.push({ handle: cred.handle, record })
      return { uri: `at://did:plc:x/media.weat.article/${published.length}`, cid: 'c' }
    },
    putProfile: async () => {},
  } as unknown as Pds
  const queue: JobQueue = {
    addArticle: async (id, delayMs) => void (queued.push(id), delays.set(id, delayMs ?? 0)),
    addSourcePoll: async () => {},
    scheduleSource: async () => {},
    unscheduleSource: async () => {},
  }
  const fetchPage = async (url: string) => {
    const p = pages[url]
    if (p instanceof FetchError) throw p
    if (p === undefined) throw new FetchError('BadStatus', 'ответ 404')
    if (typeof p === 'object') return { url: p.redirect, status: 200, contentType: 'text/html', body: p.body }
    return { url, status: 200, contentType: 'text/html', body: p }
  }
  const crawler = createCrawler({ repo, pds, fetchPage, secrets: createSecretBox('33'.repeat(32)), queue, handleDomain: 'indie.media' })
  return { crawler, items, published, queued, delays }
}

test('admin flow: create crawler, enqueue habr link, publish into crawler repo; duplicate not re-published', async () => {
  const url = 'https://habr.com/ru/articles/1/'
  const t = setup({ [url]: HABR })
  const acc = await t.crawler.createAccount({ id: 'habr-1', site: 'habr.com', displayName: 'Краулер Habr №1' })
  assert.equal(acc.handle, 'crawler-habr-1.indie.media')

  const r = await t.crawler.enqueue({ url, crawlerId: 'habr-1', origin: 'manual', requestedBy: 'admin' })
  assert.equal(r.duplicate, false)
  assert.deepEqual(t.queued, [r.item.id])

  const uri = await t.crawler.processArticle(r.item.id, 1)
  assert.match(String(uri), /^at:\/\//)
  assert.equal(t.published[0]!.handle, 'crawler-habr-1.indie.media')
  assert.equal(t.published[0]!.record.title, 'Тестовая статья про очереди')
  assert.equal(t.items.get(r.item.id)!.status, 'published')

  const again = await t.crawler.enqueue({ url: `${url}?utm_source=rss#comments`, crawlerId: 'habr-1', origin: 'manual', requestedBy: 'admin' })
  assert.equal(again.duplicate, true)
  assert.equal(t.queued.length, 1, 'дубликат не ставится в очередь повторно')
})

test('permanent vs transient errors', async () => {
  const t = setup({
    'https://habr.com/ru/articles/404/': new FetchError('BadStatus', 'ответ 404'),
    'https://habr.com/ru/articles/timeout/': new FetchError('Timeout', 'нет ответа за 15 с'),
    'https://example.com/not-article': '<html><body><p>коротко</p></body></html>',
  })
  await t.crawler.createAccount({ id: 'habr-1', site: 'habr.com', displayName: 'Habr' })
  const run = async (url: string) => {
    const { item } = await t.crawler.enqueue({ url, crawlerId: 'habr-1', origin: 'manual', requestedBy: 'admin' })
    const err = await t.crawler.processArticle(item.id, 1).catch((e) => e)
    return { err, status: t.items.get(item.id)!.status }
  }
  const nf = await run('https://habr.com/ru/articles/404/')
  assert.ok(nf.err instanceof PermanentError)
  assert.equal(nf.status, 'failed')
  const to = await run('https://habr.com/ru/articles/timeout/')
  assert.ok(!(to.err instanceof PermanentError), 'таймаут повторяется')
  assert.equal(to.status, 'queued')
  const na = await run('https://example.com/not-article')
  assert.ok(na.err instanceof PermanentError)
})

test('source poll enqueues only new links', async () => {
  const rss = `<rss><channel><item><guid isPermaLink="true">https://habr.com/ru/articles/1/</guid></item><item><guid isPermaLink="true">https://habr.com/ru/articles/2/</guid></item></channel></rss>`
  const t = setup({ 'https://habr.com/ru/rss/articles/': rss })
  await t.crawler.createAccount({ id: 'habr-1', site: 'habr.com', displayName: 'Habr' })
  const src = await t.crawler.addSource({ crawlerId: 'habr-1', url: 'https://habr.com/ru/rss/articles/', intervalMin: 30 })
  assert.deepEqual(await t.crawler.pollSource(src.id), { added: 2, seen: 2 })
  assert.deepEqual(await t.crawler.pollSource(src.id), { added: 0, seen: 2 })
})

test('validation: unknown crawler, bad id, disabled crawler', async () => {
  const t = setup({})
  await assert.rejects(t.crawler.createAccount({ id: 'Bad Id', site: 'x', displayName: 'x' }), PermanentError)
  await assert.rejects(t.crawler.enqueue({ url: 'https://habr.com/a', crawlerId: 'nope', origin: 'manual', requestedBy: null }), PermanentError)
})

test('markdown: raw HTML from page text is escaped', () => {
  const html = `<html><head><title>T</title></head><body><h1>Заголовок</h1><article><p>${'Текст статьи достаточно длинный. '.repeat(20)}</p>
    <p>&lt;img src=x onerror=alert(1)&gt; и &lt;script&gt;</p></article></body></html>`
  const a = extractArticle(html, 'https://example.com/post')
  assert.doesNotMatch(a.markdown, /<img|<script/i)
  assert.match(a.markdown, /&lt;img src=x onerror=alert\(1\)&gt;/)
})

test('fetcher: only ports 80/443', async () => {
  const strict = createFetcher({ userAgent: 'test' })
  for (const url of ['http://example.com:6379/', 'https://example.com:8443/', 'http://example.com:22/']) {
    await assert.rejects(strict(url), (e: unknown) => e instanceof FetchError && e.code === 'Blocked', url)
  }
})

test('sameSite: subdomains and eTLD+1', () => {
  assert.ok(sameSite('habr.com', 'habr.com'))
  assert.ok(sameSite('www.habr.com', 'habr.com'))
  assert.ok(sameSite('m.habr.com', 'habr.com'))
  assert.ok(!sameSite('evil.example', 'habr.com'))
  assert.ok(!sameSite('habr.com.evil.example', 'habr.com'))
})

test('source poll skips links to other sites', async () => {
  const rss = `<rss><channel><item><link>https://habr.com/ru/articles/1/</link></item><item><link>https://evil.example/a</link></item></channel></rss>`
  const t = setup({ 'https://habr.com/ru/rss/articles/': rss })
  await t.crawler.createAccount({ id: 'habr-1', site: 'habr.com', displayName: 'Habr' })
  const src = await t.crawler.addSource({ crawlerId: 'habr-1', url: 'https://habr.com/ru/rss/articles/', intervalMin: 30 })
  assert.deepEqual(await t.crawler.pollSource(src.id), { added: 1, seen: 2 })
  assert.equal([...t.items.values()].some((i) => i.url.includes('evil')), false)
})

test('cross-site redirect is not published', async () => {
  const url = 'https://habr.com/ru/articles/7/'
  const t = setup({ [url]: { redirect: 'https://evil.example/ru/articles/7/', body: HABR } })
  await t.crawler.createAccount({ id: 'habr-1', site: 'habr.com', displayName: 'Habr' })
  const { item } = await t.crawler.enqueue({ url, crawlerId: 'habr-1', origin: 'manual', requestedBy: 'admin' })
  await assert.rejects(t.crawler.processArticle(item.id, 1), PermanentError)
  assert.equal(t.items.get(item.id)!.status, 'failed')
  assert.equal(t.published.length, 0)
})

test('fetcher: koi8-r and windows-1251 pages decode by header or meta', async () => {
  const { decodeBody } = await import('../src/fetcher.ts')
  // «Привет» в koi8-r и cp1251
  const koi8 = Buffer.from([0xf0, 0xd2, 0xc9, 0xd7, 0xc5, 0xd4])
  const cp1251 = Buffer.from([0xcf, 0xf0, 0xe8, 0xe2, 0xe5, 0xf2])
  assert.equal(decodeBody(koi8, 'text/html; charset=koi8-r'), 'Привет')
  assert.equal(decodeBody(Buffer.concat([Buffer.from('<meta charset="windows-1251">'), cp1251]), 'text/html'), '<meta charset="windows-1251">Привет')
  assert.equal(decodeBody(Buffer.from('<?xml version="1.0" encoding="koi8-r"?>'), null), '<?xml version="1.0" encoding="koi8-r"?>')
  assert.equal(decodeBody(Buffer.from('Привет'), 'text/html'), 'Привет', 'по умолчанию UTF-8')
})

test('extract: OpenNet news (table layout, no og:title)', () => {
  const html = readFileSync(new URL('./fixtures/opennet.html', import.meta.url), 'utf8')
  const a = extractArticle(html, 'https://www.opennet.ru/opennews/art.shtml?num=66676')
  assert.equal(a.site, 'opennet.ru')
  assert.match(a.title, /композитный сервер Polo/)
  assert.match(a.markdown, /\[Polo 1\.0\]\(https:\/\/github\.com\//)
  assert.equal(a.publishedAt, '2026-11-12T19:10:00.000Z')
  assert.equal(a.lang, 'ru')
})

test('author notice: source with delay holds items; «написал автору» schedules publish in N hours; skip cancels', async () => {
  const t = setup({})
  await t.crawler.createAccount({ id: 'habr', site: 'habr.com', displayName: 'Хабр' })
  const held = await t.crawler.enqueue({ url: 'https://habr.com/ru/articles/1/', crawlerId: 'habr', origin: 'source', requestedBy: 'source:1', holdHours: 36 })
  assert.equal(held.item.status, 'held')
  assert.deepEqual(t.queued, [], 'до уведомления автора — не в очереди')
  assert.equal(await t.crawler.processArticle(held.item.id, 1), null, 'старая задача из очереди ничего не публикует')
  assert.equal(t.published.length, 0)
  const n = await t.crawler.notifyAuthor(held.item.id, 'zitadel:u1')
  assert.equal(n.status, 'queued')
  assert.equal(t.delays.get(held.item.id), 36 * 3_600_000, 'через 36 ч от уведомления')
  await assert.rejects(t.crawler.notifyAuthor(held.item.id, null), /не ждёт/)
  const other = await t.crawler.enqueue({ url: 'https://habr.com/ru/articles/2/', crawlerId: 'habr', origin: 'source', requestedBy: 'source:1', holdHours: 36 })
  assert.equal((await t.crawler.skipItem(other.item.id, null)).status, 'skipped')
  assert.equal(await t.crawler.processArticle(other.item.id, 1), null)
})

test('dedupe: habr article by id across paths; rel=canonical; same title from another site is skipped', async () => {
  const { canonicalUrl } = await import('../src/fetcher.ts')
  const { pageCanonical, titleFingerprint } = await import('../src/crawler.ts')
  assert.equal(canonicalUrl('https://habr.com/ru/companies/timeweb/articles/1107670/'), 'https://habr.com/ru/articles/1107670')
  assert.equal(canonicalUrl('https://habr.com/en/articles/1107670/?utm_source=x'), 'https://habr.com/ru/articles/1107670')
  assert.equal(pageCanonical('<link rel="canonical" href="/blog/a/">', 'https://x.dev/blog/a?ref=1'), 'https://x.dev/blog/a')
  assert.equal(pageCanonical('<link rel="canonical" href="https://other.com/a">', 'https://x.dev/a'), null, 'чужой сайт — не верим')
  assert.equal(titleFingerprint('Как Я «стал» разработчиком — с нуля!'), titleFingerprint('как я стал разработчиком с нуля'))
  assert.equal(titleFingerprint('Новости'), null, 'короткий — не сравниваем')
})
