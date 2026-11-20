/**
 * РФ-контур: записи с метками коллегий nsfw и politics не показываются вообще — ни в ленте, ни по прямой ссылке,
 * ни в RSS и превью (распространение такого контента в РФ — уголовный риск). Это не настройка читателя:
 * фильтр на сервере, до ответа. В глобальном контуре выключен — там решает читатель.
 *
 * Метки берём у сервиса коллегий (queryLabels). Он недоступен — закрываем всё, что узел ещё не проверял:
 * запись, вышедшую или помеченную во время сбоя, нельзя показать «на всякий случай». Проверенные чистыми
 * остаются видны (лента не пустеет), известные закрытые — закрыты; в лог — предупреждение.
 *
 * Документы внешних площадок standard.site (Leaflet, pckt, Offprint…) в РФ-контуре закрыты всегда: их не
 * проверяли наши коллегии, меток на них нет — фильтр по меткам их бы пропустил. Без обращения к лейблеру.
 */
const EXTERNAL_DOC = '/site.standard.document/'

export const RESTRICTED_COLLEGIA = ['nsfw', 'politics'] as const

export interface RestrictedFilter {
  enabled: boolean
  /** из этих uri — те, что закрыты в контуре */
  blocked(uris: string[]): Promise<Set<string>>
}

export function createRestrictedFilter(opts: { enabled: boolean; labelerUrl?: string; ttlMs?: number }): RestrictedFilter {
  const ttl = opts.ttlMs ?? 60_000
  const base = opts.labelerUrl?.replace(/\/+$/, '')
  let sources: { at: number; dids: string[] } | null = null
  const seen = new Map<string, { at: number; blocked: boolean }>()
  /** закрытые однажды — закрыты, пока метку не снимут (а не пока жив кэш) */
  const sticky = new Set<string>()

  const dids = async (): Promise<string[]> => {
    if (sources && Date.now() - sources.at < 10 * 60_000) return sources.dids
    const res = await fetch(`${base}/xrpc/app.weat.labeler.describe`, { signal: AbortSignal.timeout(3000) })
    const body = (await res.json()) as { labelers: { id: string; did: string }[] }
    const list = body.labelers.filter((l) => (RESTRICTED_COLLEGIA as readonly string[]).includes(l.id)).map((l) => l.did)
    sources = { at: Date.now(), dids: list }
    return list
  }

  return {
    enabled: opts.enabled,
    async blocked(uris) {
      const out = new Set<string>()
      if (!opts.enabled || !uris.length) return out
      for (const u of uris) if (u.includes(EXTERNAL_DOC)) out.add(u)
      if (!base) return out
      const now = Date.now()
      const ask = [...new Set(uris)].filter((u) => !out.has(u)).filter((u) => {
        const s = seen.get(u)
        if (s && now - s.at < ttl) {
          if (s.blocked) out.add(u)
          return false
        }
        return true
      })
      try {
        const src = await dids()
        for (let i = 0; i < ask.length; i += 100) {
          const chunk = ask.slice(i, i + 100)
          const q = new URLSearchParams({ uriPatterns: chunk.join(','), sources: src.join(','), limit: '250' })
          const res = await fetch(`${base}/xrpc/com.atproto.label.queryLabels?${q}`, { signal: AbortSignal.timeout(3000) })
          if (!res.ok) throw new Error(`queryLabels ${res.status}`)
          const hit = new Set(((await res.json()) as { labels: { uri: string }[] }).labels.map((l) => l.uri))
          for (const u of chunk) {
            const b = hit.has(u)
            seen.set(u, { at: now, blocked: b })
            if (b) {
              out.add(u)
              sticky.add(u)
            } else sticky.delete(u)
          }
        }
      } catch (err) {
        console.warn('restricted filter: labeler unavailable, closing unchecked records', err instanceof Error ? err.message : err)
        for (const u of ask) if (sticky.has(u) || seen.get(u)?.blocked !== false) out.add(u)
      }
      if (seen.size > 50_000) seen.clear()
      return out
    },
  }
}

/** RSS: убрать <item>, чей guid — закрытая запись */
export function filterRssItems(xml: string, blocked: Set<string>): string {
  if (!blocked.size) return xml
  return xml.replace(/<item>[\s\S]*?<\/item>\n?/g, (item) => {
    const guid = item.match(/<guid[^>]*>([^<]+)<\/guid>/)?.[1]?.replace(/&amp;/g, '&')
    return guid && blocked.has(guid) ? '' : item
  })
}

export const rssGuids = (xml: string) => [...xml.matchAll(/<guid[^>]*>([^<]+)<\/guid>/g)].map((m) => m[1]!.replace(/&amp;/g, '&'))
