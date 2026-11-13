/**
 * «Продолжить с места»: позиция ролика в браузере зрителя. Это удобство одного читателя —
 * на сервер не уходит, при очищенном хранилище ролик просто начнётся сначала.
 */
const PREFIX = 'indie-media:resume:'
/** не запоминаем начало (ещё не смотрел) и хвост (титры — считай досмотрел) */
export const RESUME_MIN_S = 5
export const RESUME_TAIL_S = 10
/** старые позиции не копим бесконечно */
const MAX_ENTRIES = 200

interface Saved {
  t: number
  at: number
}

export function getResume(key: string, duration: number): number | null {
  try {
    const raw = localStorage.getItem(PREFIX + key)
    if (!raw) return null
    const { t } = JSON.parse(raw) as Saved
    return t >= RESUME_MIN_S && (!duration || t < duration - RESUME_TAIL_S) ? t : null
  } catch {
    return null
  }
}

export function saveResume(key: string, t: number, duration: number) {
  try {
    if (t < RESUME_MIN_S || (duration && t >= duration - RESUME_TAIL_S)) {
      localStorage.removeItem(PREFIX + key)
      return
    }
    localStorage.setItem(PREFIX + key, JSON.stringify({ t: Math.floor(t), at: Date.now() } satisfies Saved))
    prune()
  } catch {
    /* хранилище недоступно (приватный режим) — без продолжения */
  }
}

export function clearResume(key: string) {
  try {
    localStorage.removeItem(PREFIX + key)
  } catch {
    /* noop */
  }
}

function prune() {
  const keys: { k: string; at: number }[] = []
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)
    if (!k?.startsWith(PREFIX)) continue
    try {
      keys.push({ k, at: (JSON.parse(localStorage.getItem(k) ?? '{}') as Saved).at ?? 0 })
    } catch {
      keys.push({ k, at: 0 })
    }
  }
  if (keys.length <= MAX_ENTRIES) return
  keys.sort((a, b) => a.at - b.at)
  for (const { k } of keys.slice(0, keys.length - MAX_ENTRIES)) localStorage.removeItem(k)
}

/** 83 → «1:23», 3725 → «1:02:05» */
export function clock(s: number): string {
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = Math.floor(s % 60)
  const mm = h ? String(m).padStart(2, '0') : String(m)
  return `${h ? `${h}:` : ''}${mm}:${String(sec).padStart(2, '0')}`
}
