import { serve } from '@hono/node-server'
import { createStaffCheck } from './staff.js'
import { createApi } from './api.js'
import { loadConfig } from './config.js'
import { createCrawler } from './crawler.js'
import { createDb, migrate, repo as makeRepo } from './db.js'
import { createFetcher } from './fetcher.js'
import { createPds } from './pds.js'
import { createQueues } from './queue.js'
import { createSecretBox } from './secretbox.js'

const config = loadConfig()
const sql = createDb(config.DATABASE_URL)
await migrate(sql)
const repo = makeRepo(sql)
const queues = createQueues(config.REDIS_URL)

const crawler = createCrawler({
  repo,
  pds: createPds(config.PDS_URL, config.PDS_ADMIN_PASSWORD),
  fetchPage: createFetcher({ userAgent: config.USER_AGENT }),
  secrets: createSecretBox(config.SECRETS_KEY),
  queue: queues.jobQueue,
  handleDomain: config.PDS_HANDLE_DOMAIN,
})

const runWorker = config.ROLE !== 'api'
const runApi = config.ROLE !== 'worker'

// расписания источников восстанавливаем при старте (upsert — идемпотентно)
if (runWorker) for (const s of await repo.sources.list()) if (s.enabled) await queues.jobQueue.scheduleSource(s)

const stopWorkers = runWorker ? queues.startWorkers(crawler, { concurrency: config.CONCURRENCY, rateMs: config.RATE_MS }) : async () => {}
const server = runApi
  ? serve(
      { fetch: createApi({ crawler, repo, queue: queues.jobQueue, adminToken: config.ADMIN_TOKEN,
        counts: queues.counts,
        isStaffAdmin:
          config.ZITADEL_ISSUER && config.ZITADEL_PROJECT_ID
            ? createStaffCheck({ issuer: config.ZITADEL_ISSUER, projectId: config.ZITADEL_PROJECT_ID, jwksUrl: config.ZITADEL_JWKS_URL })
            : undefined,
      }).fetch, port: config.PORT },
      (info) => console.log(`crawler api listening on :${info.port}`),
    )
  : null
if (runWorker) console.log(`crawler worker started (concurrency=${config.CONCURRENCY}, rate=${config.RATE_MS}ms)`)

const shutdown = async () => {
  server?.close()
  await stopWorkers()
  await queues.close()
  await sql.end()
  process.exit(0)
}
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
