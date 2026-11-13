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

export type ItemStatus = 'queued' | 'running' | 'published' | 'failed'

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
      create: async (i: { url: string; canonical: string; crawlerId: string; origin: 'manual' | 'source'; requestedBy: string | null }) =>
        (
          await sql<CrawlItem[]>`
            INSERT INTO crawler_items (url, url_canonical, crawler_id, origin, requested_by)
            VALUES (${i.url}, ${i.canonical}, ${i.crawlerId}, ${i.origin}, ${i.requestedBy})
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
    },
    sources: {
      list: () => sql<CrawlSource[]>`SELECT * FROM crawler_sources ORDER BY id`,
      get: async (id: string) => (await sql<CrawlSource[]>`SELECT * FROM crawler_sources WHERE id = ${id}`)[0],
      insert: async (s: { crawlerId: string; url: string; intervalMin: number }) =>
        (
          await sql<CrawlSource[]>`
            INSERT INTO crawler_sources (crawler_id, url, interval_min) VALUES (${s.crawlerId}, ${s.url}, ${s.intervalMin})
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
