import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import postgres from 'postgres'

export type Sql = postgres.Sql

export interface CrawlerAccount {
  id: string
  handle: string
  did: string
  password_enc: string
  display_name: string
  site: string
  enabled: boolean
  created_at: Date
}

/** held — ждёт уведомления автора; skipped — решили не публиковать */
export type ItemStatus = 'held' | 'queued' | 'running' | 'published' | 'failed' | 'skipped'

export interface CrawlItem {
  id: string
  url: string
  url_canonical: string
  crawler_id: string
  status: ItemStatus
  origin: 'manual' | 'source'
  requested_by: string | null
  title: string | null
  at_uri: string | null
  error: string | null
  attempts: number
  /** часов от уведомления автора до публикации (из источника) */
  delay_hours: number
  notified_at: Date | null
  notified_by: string | null
  publish_after: Date | null
  created_at: Date
  updated_at: Date
}

export interface CrawlSource {
  id: string
  crawler_id: string
  url: string
  interval_min: number
  enabled: boolean
  last_polled_at: Date | null
  last_error: string | null
  delay_hours: number
  max_age_hours: number | null
  link_pattern: string | null
}

export interface SourceInput {
  crawlerId: string
  url: string
  intervalMin: number
  delayHours?: number
  maxAgeHours?: number | null
  linkPattern?: string | null
}

/** правила разбора сайта (rules.ts) */
export interface SiteRules {
  host: string
  rules: string
  updated_by: string | null
  updated_at: Date
}

export function createDb(url: string): Sql {
  return postgres(url, { max: 5, onnotice: () => {} })
}

const migrationsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../migrations')

/** свои миграции с префиксом crawler/ — в общей БД с AppView */
export async function migrate(sql: Sql) {
  await sql`CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`
  for (const file of (await readdir(migrationsDir)).filter((f) => f.endsWith('.sql')).sort()) {
    const name = `crawler/${file}`
    const [done] = await sql`SELECT 1 FROM schema_migrations WHERE name = ${name}`
    if (done) continue
    const body = await readFile(path.join(migrationsDir, file), 'utf8')
    await sql.begin(async (tx) => {
      await tx.unsafe(body)
      await tx`INSERT INTO schema_migrations (name) VALUES (${name})`
    })
    console.log(`migrated ${name}`)
  }
}

export function repo(sql: Sql) {
  return {
    accounts: {
      list: () => sql<CrawlerAccount[]>`SELECT * FROM crawler_accounts ORDER BY id`,
      get: async (id: string) => (await sql<CrawlerAccount[]>`SELECT * FROM crawler_accounts WHERE id = ${id}`)[0],
      insert: async (a: Omit<CrawlerAccount, 'created_at' | 'enabled'>) =>
        (
          await sql<CrawlerAccount[]>`
            INSERT INTO crawler_accounts (id, handle, did, password_enc, display_name, site)
            VALUES (${a.id}, ${a.handle}, ${a.did}, ${a.password_enc}, ${a.display_name}, ${a.site}) RETURNING *`
        )[0]!,
      setEnabled: (id: string, enabled: boolean) => sql`UPDATE crawler_accounts SET enabled = ${enabled} WHERE id = ${id}`,
    },
    items: {
      /** null — такая ссылка уже есть (дубликат) */
      create: async (i: { url: string; canonical: string; crawlerId: string; origin: 'manual' | 'source'; requestedBy: string | null; holdHours?: number }) =>
        (
          await sql<CrawlItem[]>`
            INSERT INTO crawler_items (url, url_canonical, crawler_id, origin, requested_by, status, delay_hours)
            VALUES (${i.url}, ${i.canonical}, ${i.crawlerId}, ${i.origin}, ${i.requestedBy}, ${i.holdHours ? 'held' : 'queued'}, ${i.holdHours ?? 0})
            ON CONFLICT (url_canonical) DO NOTHING RETURNING *`
        )[0] ?? null,
      byCanonical: async (c: string) => (await sql<CrawlItem[]>`SELECT * FROM crawler_items WHERE url_canonical = ${c}`)[0],
      get: async (id: string) => (await sql<CrawlItem[]>`SELECT * FROM crawler_items WHERE id = ${id}`)[0],
      list: (limit: number) => sql<CrawlItem[]>`SELECT * FROM crawler_items ORDER BY created_at DESC LIMIT ${limit}`,
      update: (id: string, p: { status: ItemStatus; title?: string | null; atUri?: string | null; error?: string | null; attempts?: number }) =>
        sql`
          UPDATE crawler_items SET status = ${p.status},
            title = COALESCE(${p.title ?? null}, title),
            at_uri = COALESCE(${p.atUri ?? null}, at_uri),
            error = ${p.error ?? null},
            attempts = COALESCE(${p.attempts ?? null}, attempts),
            updated_at = now()
          WHERE id = ${id}`,
      /** «Написал автору»: held → queued, публикация не раньше publish_after */
      notified: async (id: string, by: string | null, delayHours: number) =>
        (
          await sql<CrawlItem[]>`
            UPDATE crawler_items SET status = 'queued', notified_at = now(), notified_by = ${by},
              delay_hours = ${delayHours}, publish_after = now() + make_interval(hours => ${delayHours}), updated_at = now()
            WHERE id = ${id} AND status = 'held' RETURNING *`
        )[0],
      skip: async (id: string, by: string | null) =>
        (await sql<CrawlItem[]>`UPDATE crawler_items SET status = 'skipped', notified_by = ${by}, updated_at = now() WHERE id = ${id} AND status IN ('held', 'queued') RETURNING *`)[0],
    },
    rules: {
      list: () => sql<SiteRules[]>`SELECT * FROM site_rules ORDER BY host`,
      get: async (host: string) => (await sql<SiteRules[]>`SELECT * FROM site_rules WHERE host = ${host}`)[0],
      put: async (host: string, rules: string, by: string | null) =>
        (
          await sql<SiteRules[]>`
            INSERT INTO site_rules (host, rules, updated_by) VALUES (${host}, ${rules}, ${by})
            ON CONFLICT (host) DO UPDATE SET rules = EXCLUDED.rules, updated_by = EXCLUDED.updated_by, updated_at = now()
            RETURNING *`
        )[0]!,
      remove: async (host: string) => {
        await sql`DELETE FROM site_rules WHERE host = ${host}`
      },
    },
    sources: {
      list: () => sql<CrawlSource[]>`SELECT * FROM crawler_sources ORDER BY id`,
      get: async (id: string) => (await sql<CrawlSource[]>`SELECT * FROM crawler_sources WHERE id = ${id}`)[0],
      insert: async (s: SourceInput) =>
        (
          await sql<CrawlSource[]>`
            INSERT INTO crawler_sources (crawler_id, url, interval_min, delay_hours, max_age_hours, link_pattern)
            VALUES (${s.crawlerId}, ${s.url}, ${s.intervalMin}, ${s.delayHours ?? 0}, ${s.maxAgeHours ?? null}, ${s.linkPattern ?? null})
            RETURNING *`
        )[0]!,
      setEnabled: (id: string, enabled: boolean) => sql`UPDATE crawler_sources SET enabled = ${enabled} WHERE id = ${id}`,
      polled: (id: string, error: string | null) =>
        sql`UPDATE crawler_sources SET last_polled_at = now(), last_error = ${error} WHERE id = ${id}`,
      remove: (id: string) => sql`DELETE FROM crawler_sources WHERE id = ${id}`,
    },
  }
}

export type Repo = ReturnType<typeof repo>
