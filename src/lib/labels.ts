import { useEffect, useState } from 'react'

/**
 * Метки коллегий присяжных из сервиса лейблеров (/api/labels → services/labeler).
 * Метки публичные и подписанные; что с ними делать (скрыть/предупредить/ничего), решает читатель
 * в настройках модерации — здесь только значения меток на записи.
 */

export interface LiveLabel {
  src: string
  uri: string
  val: string
  cts: string
}

const cache = new Map<string, { at: number; labels: LiveLabel[] }>()
const TTL = 60_000

export async function fetchLabels(uri: string): Promise<LiveLabel[]> {
  const hit = cache.get(uri)
  if (hit && Date.now() - hit.at < TTL) return hit.labels
  const res = await fetch(`/api/labels?${new URLSearchParams({ uris: uri })}`).catch(() => null)
  const labels = res?.ok ? (((await res.json()) as { labels?: LiveLabel[] }).labels ?? []) : []
  cache.set(uri, { at: Date.now(), labels })
  return labels
}

/** значения меток на записи; null — ещё грузятся или записи нет в сети (демо-статья) */
export function useLiveLabels(uri: string | undefined): LiveLabel[] | null {
  const [state, setState] = useState<{ uri: string; labels: LiveLabel[] } | null>(null)
  useEffect(() => {
    if (!uri?.startsWith('at://')) return
    let alive = true
    void fetchLabels(uri).then((labels) => alive && setState({ uri, labels }))
    return () => {
      alive = false
    }
  }, [uri])
  return uri && state?.uri === uri ? state.labels : null
}
