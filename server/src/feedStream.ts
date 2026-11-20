import type { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import type { RestrictedFilter } from './restricted.js'

/**
 * Живая лента (SSE): GET /api/feed/stream — статья появилась на сайте, изменилась или удалена.
 *
 * Источники:
 *   индекс ленты (services/feed, /feed-api/stream) — всё, что записано в AT: наши PDS, standard.site из сети;
 *   охлаждение (cooldown) — статья уже видна на сайте, но в AT уйдёт через 24 ч: событие с pending: true.
 * Когда статья после охлаждения уходит в AT, индекс пришлёт created ещё раз — клиент сводит события по uri.
 *
 * К ленте — одно соединение на весь AppView, сколько бы ни было слушателей; без слушателей оно закрыто.
 * РФ-контур: закрытое метками (nsfw, politics) и перенесённое автору (claims) не рассылается.
 * Только метаданные (заголовок, адрес, дата) — текст статьи читают обычным запросом.
 */

export interface FeedEvent {
  type: 'created' | 'updated' | 'deleted'
  uri: string
  did: string
  /** короткий id: /article/<id> */
  id: string
  title?: string
  createdAt?: string
  paid?: boolean
  sourceSite?: string
  /** видна на сайте, в AT ещё не ушла (охлаждение) */
  pending?: boolean
  at: string
}

type Listener = (name: string, data: string, id: string) => void

const MAX_LISTENERS = 2000
/** последние события для переподключения по Last-Event-ID */
const HISTORY = 500
/**
 * Caddy ограничивает запись ответа 60 с (timeouts.write) — поток сам закрывается раньше, а EventSource
 * переподключается с Last-Event-ID и получает пропущенное из истории: ни одно событие не теряется
 */
const STREAM_MS = 50_000

export interface FeedStream {
  /** событие с сайта (охлаждение) — сразу всем слушателям */
  emit(ev: Omit<FeedEvent, 'at' | 'id' | 'did'> & { did?: string }): void
  listen(fn: Listener): () => void
  /** события после id (Last-Event-ID); null — id слишком старый или чужой, пропуск возможен */
  since(id: string): { event: string; data: string; id: string }[] | null
  readonly size: number
}

export const shortId = (uri: string) => {
  const [, , did = '', , rkey = ''] = uri.split('/')
  return { did, id: `${rkey}-${did.slice(-6)}` }
}

export function createFeedStream(d: { feedUrl?: string; restricted?: RestrictedFilter; moved?: (uris: string[]) => Promise<Map<string, string>> }): FeedStream {
  const listeners = new Set<Listener>()
  let upstream: AbortController | null = null
  const history: { event: string; data: string; id: string; n: number }[] = []
  // id = <запуск процесса>-<номер>: после перезапуска AppView старый Last-Event-ID не спутать с новым
  const boot = Date.now().toString(36)
  let seq = 0

  const hidden = async (uri: string) => {
    const [blocked, moved] = await Promise.all([
      d.restricted?.enabled ? d.restricted.blocked([uri]).catch(() => new Set<string>()) : Promise.resolve(new Set<string>()),
      d.moved ? d.moved([uri]).catch(() => new Map<string, string>()) : Promise.resolve(new Map<string, string>()),
    ])
    return blocked.has(uri) || moved.has(uri)
  }

  const send = (name: string, data: string) => {
    const n = ++seq
    const id = `${boot}-${n}`
    history.push({ event: name, data, id, n })
    if (history.length > HISTORY) history.shift()
    for (const fn of listeners) fn(name, data, id)
  }

  const deliver = async (ev: FeedEvent) => {
    // удаление рассылаем всегда: клиенту нужно убрать карточку, даже если её закрыли метками
    if (ev.type !== 'deleted' && (await hidden(ev.uri))) return
    send(ev.type, JSON.stringify(ev))
  }

  /** SSE-поток ленты → события; обрыв — переподключение с паузой, пока есть слушатели */
  const connect = async (ctrl: AbortController) => {
    let backoff = 1000
    while (!ctrl.signal.aborted && d.feedUrl) {
      try {
        const res = await fetch(`${d.feedUrl.replace(/\/$/, '')}/feed-api/stream`, { headers: { accept: 'text/event-stream' }, signal: ctrl.signal })
        if (!res.ok || !res.body) throw new Error(`feed stream ${res.status}`)
        backoff = 1000
        const reader = res.body.pipeThrough(new TextDecoderStream()).getReader()
        let buf = ''
        for (;;) {
          const { value, done } = await reader.read()
          if (done) break
          buf += value
          let cut: number
          while ((cut = buf.indexOf('\n\n')) >= 0) {
            const frame = buf.slice(0, cut)
            buf = buf.slice(cut + 2)
            let name = 'message'
            const data: string[] = []
            for (const line of frame.split('\n')) {
              if (line.startsWith('event:')) name = line.slice(6).trim()
              else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''))
            }
            if (!data.length) continue
            if (name === 'lagged') {
              send('lagged', data.join('\n'))
              continue
            }
            if (name !== 'created' && name !== 'updated' && name !== 'deleted') continue
            try {
              void deliver(JSON.parse(data.join('\n')) as FeedEvent)
            } catch {
              /* битый кадр — пропускаем */
            }
          }
        }
      } catch {
        if (ctrl.signal.aborted) return
      }
      await new Promise((r) => setTimeout(r, backoff).unref?.())
      backoff = Math.min(backoff * 2, 30_000)
    }
  }

  return {
    get size() {
      return listeners.size
    },
    emit(ev) {
      const { did, id } = shortId(ev.uri)
      void deliver({ ...ev, did: ev.did ?? did, id, at: new Date().toISOString() })
    },
    since(id) {
      const [b, raw] = id.split('-')
      const n = Number(raw)
      if (b !== boot || !Number.isInteger(n)) return null
      if (history.length && n < history[0]!.n - 1) return null
      return history.filter((h) => h.n > n).map(({ event, data, id }) => ({ event, data, id }))
    },
    listen(fn) {
      listeners.add(fn)
      if (!upstream && d.feedUrl) {
        upstream = new AbortController()
        void connect(upstream)
      }
      return () => {
        listeners.delete(fn)
        if (!listeners.size && upstream) {
          upstream.abort()
          upstream = null
        }
      }
    },
  }
}

export function mountFeedStreamRoute(app: Hono, stream: FeedStream) {
  app.get('/feed/stream', (c) => {
    if (stream.size >= MAX_LISTENERS) return c.json({ error: 'TooManyListeners', message: 'Слишком много подписчиков — попробуйте позже' }, 503)
    c.header('cache-control', 'no-cache, no-transform')
    // Caddy и другие прокси не должны копить поток
    c.header('x-accel-buffering', 'no')
    const lastId = c.req.header('last-event-id') ?? c.req.query('lastEventId')
    return streamSSE(c, async (s) => {
      const queue: { event: string; data: string; id?: string }[] = []
      let wake: (() => void) | null = null
      const off = stream.listen((event, data, id) => {
        // медленный клиент не копит события бесконечно: держим последние 200
        if (queue.length >= 200) queue.shift()
        queue.push({ event, data, id })
        wake?.()
      })
      // клиент ушёл — отписаться и разбудить ожидание, чтобы цикл завершился сразу
      s.onAbort(() => {
        off()
        wake?.()
      })
      const until = Date.now() + STREAM_MS
      // переподключение: сначала пропущенное; id потерян — lagged, клиент перечитает ленту
      if (lastId) {
        const missed = stream.since(lastId)
        if (missed) queue.unshift(...missed)
        else queue.unshift({ event: 'lagged', data: '{"missed":null}' })
      }
      // клиент переподключится через секунду, когда поток закроется или оборвётся
      await s.writeSSE({ event: 'ready', data: '{}', retry: 1000 })
      try {
        while (!s.aborted && !s.closed && Date.now() < until) {
          const next = queue.shift()
          if (next) {
            await s.writeSSE(next)
            continue
          }
          // пусто — ждём событие или 20 с и шлём ping, чтобы прокси не закрыли тихое соединение
          await new Promise<void>((r) => {
            const t = setTimeout(r, Math.min(20_000, Math.max(0, until - Date.now())))
            t.unref?.()
            wake = () => {
              clearTimeout(t)
              r()
            }
          })
          wake = null
          if (!queue.length && !s.aborted && Date.now() < until) await s.writeSSE({ event: 'ping', data: '{}' })
        }
      } finally {
        off()
      }
    })
  })
}
