import * as Y from 'yjs'

/**
 * Локальный Yjs-provider на BroadcastChannel: синхронизация документа
 * между вкладками ЭТОГО браузера по Yjs update protocol.
 * Это НЕ сетевая collaboration: для комнат между устройствами нужен sync server
 * (y-websocket/y-webrtc), который здесь намеренно не имитируется.
 *
 * Возвращает { hasPeer, disconnect }: hasPeer=true, если за waitMs миллисекунд
 * другая вкладка прислала состояние — тогда локальную инициализацию пропускают,
 * чтобы не задвоить содержимое.
 */
export function connectBroadcastDoc(
  ydoc: Y.Doc,
  roomId: string,
  opts?: { waitMs?: number },
): { ready: Promise<boolean>; disconnect: () => void } {
  const channel = new BroadcastChannel(`indie-media:ydoc:${roomId}`)
  const origin = { bc: true }
  let gotPeerState = false

  const onUpdate = (update: Uint8Array, src: unknown) => {
    if (src === origin) return
    channel.postMessage({ type: 'update', update })
  }
  ydoc.on('update', onUpdate)

  channel.onmessage = (e: MessageEvent) => {
    const m = e.data as { type?: string; update?: ArrayBuffer | Uint8Array } | null
    if (!m || !m.update) return
    const update = m.update instanceof Uint8Array ? m.update : new Uint8Array(m.update)
    if (m.type === 'update' || m.type === 'sync-state') {
      if (m.type === 'sync-state') gotPeerState = true
      Y.applyUpdate(ydoc, update, origin)
    } else if (m.type === 'sync-request') {
      channel.postMessage({ type: 'sync-state', update: Y.encodeStateAsUpdate(ydoc) })
    }
  }

  // новая вкладка просит состояние у уже открытых
  channel.postMessage({ type: 'sync-request' })
  const ready = new Promise<boolean>((resolve) =>
    setTimeout(() => resolve(gotPeerState), opts?.waitMs ?? 400),
  )

  return {
    ready,
    disconnect: () => {
      ydoc.off('update', onUpdate)
      channel.close()
    },
  }
}
