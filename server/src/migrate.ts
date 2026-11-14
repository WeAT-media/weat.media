import { readdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { createDb, type Sql } from './db.js'

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../migrations')

/**
 * На standby schema_migrations приходит репликацией с primary (публикация FOR ALL TABLES), а DDL — нет:
 * резерв «видел» миграцию, но таблиц у него не было (так 027 сломала RU-2). Поэтому standby ведёт свой учёт
 * (schema_migrations_local — её на primary нет, репликация её не трогает), применяет пропущенное сам
 * («уже существует» — значит, применено раньше) и обновляет подписки, чтобы новые таблицы начали копироваться.
 */
const EXISTS = new Set(['42P07', '42701', '42710', '42P06', '42723', '23505'])

export async function migrate(sql: Sql, opts: { standby?: boolean } = {}): Promise<void> {
  const table = opts.standby ? 'schema_migrations_local' : 'schema_migrations'
  await sql.unsafe(`CREATE TABLE IF NOT EXISTS ${table} (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`)
  const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort()
  for (const name of files) {
    const [done] = await sql.unsafe(`SELECT 1 FROM ${table} WHERE name = $1`, [name])
    if (done) continue
    const body = await readFile(path.join(dir, name), 'utf8')
    try {
      await sql.begin(async (tx) => {
        await tx.unsafe(body)
        await tx.unsafe(`INSERT INTO ${table} (name) VALUES ($1)`, [name])
      })
      console.log(`migrated ${name}`)
    } catch (e) {
      const code = (e as { code?: string }).code
      if (!opts.standby || !code || !EXISTS.has(code)) throw e
      await sql.unsafe(`INSERT INTO ${table} (name) VALUES ($1) ON CONFLICT DO NOTHING`, [name])
      console.log(`migration ${name}: already applied on this standby`)
    }
  }
  if (opts.standby) {
    for (const { subname } of await sql<{ subname: string }[]>`SELECT subname FROM pg_subscription`) {
      await sql.unsafe(`ALTER SUBSCRIPTION ${JSON.stringify(subname)} REFRESH PUBLICATION`).catch((e: Error) => console.error(`refresh ${subname}: ${e.message}`))
    }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is required')
  const sql = createDb(url)
  await migrate(sql)
  await sql.end()
}
