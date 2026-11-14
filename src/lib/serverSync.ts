import * as Y from 'yjs'
import { shared } from '@/lib/api'

/**
 * Сетевая синхронизация документа Yjs через AppView (совместное редактирование по ссылке /shared-draft).
 * Свои изменения копятся ~0,4 с и уходят одним обновлением; чужие забираются опросом раз в 1,5 с.
 * Обновления Yjs идемпотентны — своё, вернувшееся с сервера, ничего не ломает.
 *
 * ready — первый ответ сервера: true, если документ уже наполнен. Пустой документ наполняет только автор
 * (seed); остальные ждут его состояния (waitForState) — иначе у документа было бы два корня.
 */
export const SEED_ORIGIN = { seed: true }

export interface ServerDocConnection {
  ready: Promise<boolean>
  waitForState: () => Promise<void>
  seed: (state: Uint8Array) => Promise<boolean>
  disconnect: () => void
}

const toB64 = (u: Uint8Array) => {
  let s = ''
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000))
  return btoa(s)
}
const fromB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))

export function connectServerDoc(
  ydoc: Y.Doc,
  token: string,
  opts: { takeEdited: () => boolean; onStatus?: (s: 'ok' | 'offline' | 'expired') => void },
): ServerDocConnection {
  const origin = { server: true }
  let after = 0
  let pending: Uint8Array[] = []
  let flushTimer: number | undefined
  let pollTimer: number | undefined
  let stopped = false
  let hasState = false
  const stateWaiters: (() => void)[] = []
  let resolveReady: (v: boolean) => void = () => {}
  const ready = new Promise<boolean>((r) => (resolveReady = r))

  const gotState = () => {
    if (hasState) return
    hasState = true
    stateWaiters.splice(0).forEach((f) => f())
  }

  const flush = async () => {
    flushTimer = undefined
    if (!pending.length || stopped) return
    const batch = pending
    pending = []
    const data = Y.mergeUpdates(batch)
    try {
      await shared.push(token, { data: toB64(data), edited: opts.takeEdited() })
      opts.onStatus?.('ok')
    } catch (e) {
      if ((e as { status?: number }).status === 410) return stop('expired')
      // сеть пропала — вернём в очередь, уйдёт со следующим
      pending = [data, ...pending]
      opts.onStatus?.('offline')
      flushTimer = window.setTimeout(() => void flush(), 3000)
    }
  }

  const onUpdate = (update: Uint8Array, src: unknown) => {
    if (src === origin || src === SEED_ORIGIN || stopped) return
    pending.push(update)
    if (flushTimer === undefined) flushTimer = window.setTimeout(() => void flush(), 400)
  }
  ydoc.on('update', onUpdate)

  const poll = async () => {
    pollTimer = undefined
    if (stopped) return
    try {
      const { updates } = await shared.updates(token, after)
      for (const u of updates) {
        Y.applyUpdate(ydoc, fromB64(u.data), origin)
        after = Math.max(after, u.seq)
      }
      if (updates.length) gotState()
      resolveReady(updates.length > 0)
      opts.onStatus?.('ok')
    } catch (e) {
      if ((e as { status?: number }).status === 410) return stop('expired')
      opts.onStatus?.('offline')
    }
    if (!stopped) pollTimer = window.setTimeout(() => void poll(), document.hidden ? 5000 : 1500)
  }
  void poll()

  function stop(status?: 'expired') {
    stopped = true
    ydoc.off('update', onUpdate)
    window.clearTimeout(flushTimer)
    window.clearTimeout(pollTimer)
    resolveReady(false)
    if (status) opts.onStatus?.(status)
  }

  return {
    ready,
    waitForState: () => (hasState ? Promise.resolve() : new Promise<void>((r) => stateWaiters.push(r))),
    async seed(state) {
      try {
        await shared.push(token, { data: toB64(state), seed: true })
        gotState()
        return true
      } catch {
        return false
      }
    },
    disconnect: () => {
      void flush()
      stop()
    },
  }
}
