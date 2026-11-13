/** Видео для записи media.weat.article (лексикон: #video) */
export interface RecordVideo {
  source: 'native' | 'youtube' | 'loom'
  url?: string
  videoId?: string
  title?: string
  description?: string
  duration?: number
  preview?: { start: number; end: number }
}

/** ссылка из редактора → видео записи: YouTube и Loom — по id ролика, остальное — файл по https */
export function videoFromLink(link: string): RecordVideo | null {
  let u: URL
  try {
    u = new URL(link.trim())
  } catch {
    return null
  }
  const host = u.hostname.replace(/^www\.|^m\./, '')
  const id = (s: string | null | undefined) => (s && /^[A-Za-z0-9_-]{1,64}$/.test(s) ? s : null)
  if (host === 'youtu.be') {
    const v = id(u.pathname.slice(1))
    return v ? { source: 'youtube', videoId: v } : null
  }
  if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    const v = id(u.searchParams.get('v')) ?? id(/^\/(?:shorts|embed|live)\/([^/?#]+)/.exec(u.pathname)?.[1])
    return v ? { source: 'youtube', videoId: v } : null
  }
  if (host === 'loom.com') {
    const v = id(/^\/(?:share|embed)\/([^/?#]+)/.exec(u.pathname)?.[1])
    return v ? { source: 'loom', videoId: v } : null
  }
  if (u.protocol === 'https:' || (u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1'))) {
    return { source: 'native', url: u.toString() }
  }
  return null
}
