import { readdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { createDb, type Sql } from './db.js'

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../migrations')

export async function migrate(sql: Sql): Promise<void> {
  await sql`CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`
  const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort()
  for (const name of files) {
    const [done] = await sql`SELECT 1 FROM schema_migrations WHERE name = ${name}`
    if (done) continue
    const body = await readFile(path.join(dir, name), 'utf8')
    await sql.begin(async (tx) => {
      await tx.unsafe(body)
      await tx`INSERT INTO schema_migrations (name) VALUES (${name})`
    })
    console.log(`migrated ${name}`)
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is required')
  const sql = createDb(url)
  await migrate(sql)
  await sql.end()
}
