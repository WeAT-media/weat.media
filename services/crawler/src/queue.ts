import { Queue, UnrecoverableError, Worker } from 'bullmq'
import { Redis } from 'ioredis'
import { PermanentError, type Crawler, type JobQueue } from './crawler.js'
import type { CrawlSource } from './db.js'

/**
 * Очереди BullMQ:
 *  crawl-article — одна статья (ручная ссылка админа или новая ссылка из RSS);
 *  crawl-source  — опрос RSS источника по расписанию (автоматический пуш).
 */
export const ARTICLE_QUEUE = 'crawl-article'
export const SOURCE_QUEUE = 'crawl-source'
const ATTEMPTS = 4

export function createQueues(redisUrl: string) {
  const connection = new Redis(redisUrl, { maxRetriesPerRequest: null })
  const article = new Queue(ARTICLE_QUEUE, { connection })
  const source = new Queue(SOURCE_QUEUE, { connection })

  const jobQueue: JobQueue = {
    async addArticle(itemId, delayMs) {
      const jobId = `item-${itemId}`
      // jobId фиксирован, а упавшие/завершённые задачи хранятся: без этого повтор — пустая операция
      const existing = await article.getJob(jobId)
      if (existing) {
        const state = await existing.getState()
        if (state === 'failed') return existing.retry('failed')
        if (state === 'completed') await existing.remove()
        else return // уже в очереди или выполняется — идемпотентно
      }
      await article.add(
        'article',
        { itemId },
        {
          jobId, // одна задача на ссылку
          ...(delayMs ? { delay: delayMs } : {}),
          attempts: ATTEMPTS,
          backoff: { type: 'exponential', delay: 30_000 },
          removeOnComplete: { age: 7 * 24 * 3600, count: 5000 },
          removeOnFail: { age: 30 * 24 * 3600 },
        },
      )
    },
    async addSourcePoll(sourceId) {
      await source.add('poll', { sourceId }, { attempts: 2, backoff: { type: 'fixed', delay: 60_000 }, removeOnComplete: 100, removeOnFail: 500 })
    },
    async scheduleSource(s: CrawlSource) {
      await source.upsertJobScheduler(`source-${s.id}`, { every: s.interval_min * 60_000 }, { name: 'poll', data: { sourceId: s.id } })
    },
    async unscheduleSource(sourceId) {
      await source.removeJobScheduler(`source-${sourceId}`)
    },
  }

  function startWorkers(crawler: Crawler, opts: { concurrency: number; rateMs: number }) {
    const articleWorker = new Worker(
      ARTICLE_QUEUE,
      async (job) => {
        try {
          return await crawler.processArticle(job.data.itemId as string, job.attemptsMade + 1)
        } catch (err) {
          // постоянная ошибка — без повторов
          if (err instanceof PermanentError) throw new UnrecoverableError(err.message)
          throw err
        }
      },
      {
        connection,
        concurrency: opts.concurrency,
        // вежливость к источникам: не чаще одного запроса за rateMs
        ...(opts.rateMs > 0 ? { limiter: { max: 1, duration: opts.rateMs } } : {}),
      },
    )
    articleWorker.on('failed', (job, err) => {
      if (!job) return
      const final = err instanceof UnrecoverableError || job.attemptsMade >= (job.opts.attempts ?? 1)
      if (final) void crawler.markFailed(job.data.itemId as string, err.message)
    })

    const sourceWorker = new Worker(SOURCE_QUEUE, async (job) => crawler.pollSource(job.data.sourceId as string), { connection, concurrency: 1 })

    return async () => {
      await Promise.all([articleWorker.close(), sourceWorker.close()])
    }
  }

  async function counts() {
    const [a, s] = await Promise.all([
      article.getJobCounts('waiting', 'active', 'delayed', 'failed', 'completed'),
      source.getJobCounts('waiting', 'active', 'delayed', 'failed', 'completed'),
    ])
    return { [ARTICLE_QUEUE]: a, [SOURCE_QUEUE]: s }
  }

  return {
    jobQueue,
    startWorkers,
    counts,
    close: async () => {
      await Promise.all([article.close(), source.close()])
      connection.disconnect()
    },
  }
}
