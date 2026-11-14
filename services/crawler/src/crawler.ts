import { randomBytes } from 'node:crypto'
import type { CrawlerAccount, CrawlSource, Repo, SourceInput } from './db.js'
import { extractByRules, RulesError } from './rules.js'
import { ExtractError, extractArticle, listingLinks, rssLinks } from './extract.js'
import { FetchError, canonicalUrl, type FetchPage } from './fetcher.js'
import { PdsError, type Pds } from './pds.js'
import { ARTICLE_COLLECTION, articleRecord } from './record.js'
import type { SecretBox } from './secretbox.js'

/** Очередь задач — интерфейс, чтобы логику можно было проверить без Redis */
export interface JobQueue {
  /** delayMs — отсрочка публикации (после уведомления автора) */
  addArticle(itemId: string, delayMs?: number): Promise<void>
  addSourcePoll(sourceId: string): Promise<void>
  scheduleSource(source: CrawlSource): Promise<void>
  unscheduleSource(sourceId: string): Promise<void>
}

/** ошибка, которую бессмысленно повторять: битая ссылка, внутренний адрес, не статья */
export class PermanentError extends Error {}

export interface CrawlerDeps {
  repo: Repo
  pds: Pds
  fetchPage: FetchPage
  secrets: SecretBox
  queue: JobQueue
  handleDomain: string
}

/** Упрощённый «сайт» (eTLD+1): последние две метки хоста без www */
export function siteOf(host: string): string {
  const h = host.toLowerCase().replace(/\.$/, '').replace(/^www\./, '')
  return h.split('.').slice(-2).join('.')
}

/** Хост относится к тому же сайту, что и эталон (совпадает, поддомен или общий eTLD+1) */
export function sameSite(host: string, ref: string): boolean {
  const a = host.toLowerCase().replace(/^www\./, '')
  const b = ref.toLowerCase().replace(/^www\./, '')
  return a === b || a.endsWith(`.${b}`) || siteOf(a) === siteOf(b)
}

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname
  } catch {
    return null
  }
}

const ACCOUNT_ID = /^[a-z0-9][a-z0-9-]{1,30}$/

export function createCrawler(d: CrawlerDeps) {
  const cred = (a: CrawlerAccount) => ({ handle: a.handle, password: d.secrets.open(a.password_enc) })

  return {
    /** Аккаунт краулера на нашем PDS: crawler-habr-1.indie.media */
    async createAccount(input: { id: string; site: string; displayName: string }) {
      if (!ACCOUNT_ID.test(input.id)) throw new PermanentError('id: латиница, цифры и дефис, 2–31 символ')
      if (await d.repo.accounts.get(input.id)) throw new PermanentError('Краулер с таким id уже есть')
      const handle = `crawler-${input.id}.${d.handleDomain}`
      const password = randomBytes(24).toString('base64url')
      const s = await d.pds.createAccount(handle, `crawler-${input.id}@crawler.${d.handleDomain}`, password)
      const acc = await d.repo.accounts.insert({
        id: input.id,
        handle: s.handle,
        did: s.did,
        password_enc: d.secrets.seal(password),
        display_name: input.displayName,
        site: input.site,
      })
      await d.pds
        .putProfile(cred(acc), input.displayName, `Краулер Indie.media: переносит статьи с ${input.site} с указанием источника.`)
        .catch(() => {})
      return acc
    },

    /** Поставить ссылку в очередь. Повторная ссылка не публикуется второй раз */
    /** holdHours > 0 — не публиковать, пока сотрудник не напишет автору; потом — через holdHours (notifyAuthor) */
    async enqueue(input: { url: string; crawlerId: string; origin: 'manual' | 'source'; requestedBy: string | null; holdHours?: number }) {
      const acc = await d.repo.accounts.get(input.crawlerId)
      if (!acc) throw new PermanentError('Нет такого краулера')
      if (!acc.enabled) throw new PermanentError('Краулер выключен')
      let canonical: string
      try {
        canonical = canonicalUrl(input.url)
        if (!/^https?:$/.test(new URL(canonical).protocol)) throw new Error()
      } catch {
        throw new PermanentError('Некорректная ссылка')
      }
      const item = await d.repo.items.create({ url: input.url, canonical, crawlerId: acc.id, origin: input.origin, requestedBy: input.requestedBy, holdHours: input.holdHours })
      if (!item) return { duplicate: true as const, item: (await d.repo.items.byCanonical(canonical))! }
      if (item.status !== 'held') await d.queue.addArticle(item.id)
      return { duplicate: false as const, item }
    },

    /** сотрудник написал автору: отсчёт отсрочки — с этого момента */
    async notifyAuthor(itemId: string, by: string | null, delayHours?: number) {
      const cur = await d.repo.items.get(itemId)
      if (!cur) throw new PermanentError('Задача не найдена')
      const hours = delayHours ?? (cur.delay_hours || 36)
      const item = await d.repo.items.notified(itemId, by, hours)
      if (!item) throw new PermanentError('Статья не ждёт уведомления автора')
      await d.queue.addArticle(item.id, hours * 3_600_000)
      return item
    },

    async skipItem(itemId: string, by: string | null) {
      const item = await d.repo.items.skip(itemId, by)
      if (!item) throw new PermanentError('Эту статью уже не отменить')
      return item
    },

    /**
     * Проверка правил разбора на живой странице (редактор в админке, как у Instant View): ничего не публикует.
     * rules не задан — сохранённые правила хоста; ответ — что извлеклось или ошибка с номером строки.
     */
    async previewRules(url: string, rules?: string) {
      let page: Awaited<ReturnType<FetchPage>>
      try {
        page = await d.fetchPage(url)
      } catch (err) {
        return { host: hostOf(url) ?? '', matched: false, error: `Страница не загрузилась: ${err instanceof Error ? err.message : String(err)}`, article: null }
      }
      const host = (hostOf(page.url) ?? '').replace(/^www\./, '')
      const src = rules ?? (await d.repo.rules.get(host))?.rules
      if (!src) return { host, matched: false, error: 'Для этого сайта правил нет — сработает встроенный разбор', article: null }
      try {
        const article = extractByRules(src, page.body, page.url)
        return { host, matched: !!article, error: article ? null : 'Условия правил (?path, ?domain…) к этой странице не подходят', article }
      } catch (err) {
        return { host, matched: true, error: err instanceof Error ? err.message : String(err), article: null }
      }
    },

    /** Шаг очереди crawl-article: загрузить, извлечь, опубликовать в репозиторий краулера */
    async processArticle(itemId: string, attempt: number) {
      const item = await d.repo.items.get(itemId)
      if (!item) throw new PermanentError('Задача удалена')
      if (item.status === 'published') return item.at_uri
      // ждёт уведомления автора или отменена — не публикуем (задача могла остаться от старой логики)
      if (item.status === 'held' || item.status === 'skipped') return null
      if (item.publish_after && item.publish_after.getTime() > Date.now() + 60_000) throw new Error('Рано: публикация после ' + item.publish_after.toISOString())
      const acc = await d.repo.accounts.get(item.crawler_id)
      if (!acc) throw new PermanentError('Краулер удалён')
      await d.repo.items.update(item.id, { status: 'running', attempts: attempt })
      try {
        const page = await d.fetchPage(item.url)
        // редирект на чужой сайт — не публикуем чужое от имени источника
        const finalHost = hostOf(page.url)
        if (!finalHost || !sameSite(finalHost, new URL(item.url).hostname)) {
          throw new ExtractError(`Редирект на другой сайт: ${finalHost ?? page.url}`)
        }
        // в записи — чистая ссылка на оригинал (без utm), извлекаем по фактическому адресу после редиректов
        // правила разбора сайта (как Instant View) — по хосту без www
        const siteRules = await d.repo.rules.get(finalHost.replace(/^www\./, ''))
        const byRules = siteRules ? (h: string, u: string) => extractByRules(siteRules.rules, h, u) : undefined
        const article = { ...extractArticle(page.body, page.url, byRules), url: item.url_canonical }
        const { uri } = await d.pds.createRecord(cred(acc), ARTICLE_COLLECTION, articleRecord(article))
        await d.repo.items.update(item.id, { status: 'published', title: article.title, atUri: uri, attempts: attempt })
        return uri
      } catch (err) {
        const permanent =
          err instanceof ExtractError ||
          err instanceof RulesError ||
          (err instanceof FetchError && ['BadUrl', 'Blocked', 'BadType', 'TooLarge'].includes(err.code)) ||
          (err instanceof FetchError && err.code === 'BadStatus' && /ответ 4\d\d/.test(err.message) && !/ответ 429/.test(err.message)) ||
          (err instanceof PdsError && err.status === 400)
        const message = err instanceof Error ? err.message : String(err)
        // статус failed — только для окончательной ошибки; повтор оставляет queued
        await d.repo.items.update(item.id, { status: permanent ? 'failed' : 'queued', error: message, attempts: attempt })
        throw permanent ? new PermanentError(message) : err
      }
    },

    /** Финал после исчерпания повторов */
    async markFailed(itemId: string, error: string) {
      await d.repo.items.update(itemId, { status: 'failed', error })
    },

    /** Шаг очереди crawl-source: новые ссылки из RSS -> в очередь статей */
    async pollSource(sourceId: string) {
      const src = await d.repo.sources.get(sourceId)
      if (!src || !src.enabled) return { added: 0, seen: 0 }
      try {
        const page = await d.fetchPage(src.url)
        // RSS/Atom; источник со шаблоном ссылок — страница-список без RSS
        const links = src.link_pattern ? listingLinks(page.body, page.url, new RegExp(src.link_pattern)).slice(0, 200) : rssLinks(page.body).slice(0, 50)
        const now = Date.now()
        // только ссылки того же сайта, что RSS или сайт аккаунта: лента не может подсунуть чужие страницы
        const acc = await d.repo.accounts.get(src.crawler_id)
        const refs = [new URL(src.url).hostname, acc?.site ? (hostOf(acc.site) ?? acc.site) : null].filter((x): x is string => !!x)
        let added = 0
        for (const l of links) {
          const h = hostOf(l.url)
          if (!h || !refs.some((r) => sameSite(h, r))) continue
          const published = l.date ? Date.parse(l.date) : null
          // только свежее: «за последние N часов» — по дате записи в ленте
          if (src.max_age_hours && published && now - published > src.max_age_hours * 3_600_000) continue
          // отсрочка у источника — статья ждёт, пока сотрудник напишет автору; отсчёт — от уведомления
          const r = await this.enqueue({ url: l.url, crawlerId: src.crawler_id, origin: 'source', requestedBy: `source:${src.id}`, holdHours: src.delay_hours || undefined }).catch(() => null)
          if (r && !r.duplicate) added++
        }
        await d.repo.sources.polled(src.id, null)
        return { added, seen: links.length }
      } catch (err) {
        await d.repo.sources.polled(src.id, err instanceof Error ? err.message : String(err))
        throw err
      }
    },

    async addSource(input: SourceInput) {
      if (!(await d.repo.accounts.get(input.crawlerId))) throw new PermanentError('Нет такого краулера')
      try {
        if (!/^https?:$/.test(new URL(input.url).protocol)) throw new Error()
      } catch {
        throw new PermanentError('Некорректная ссылка на RSS')
      }
      if (input.linkPattern) {
        try {
          new RegExp(input.linkPattern)
        } catch {
          throw new PermanentError('Неверный шаблон ссылок (регулярное выражение)')
        }
      }
      const src = await d.repo.sources.insert(input)
      await d.queue.scheduleSource(src)
      await d.queue.addSourcePoll(src.id)
      return src
    },
  }
}

export type Crawler = ReturnType<typeof createCrawler>
