import type { ReactNode } from 'react'

/** Таймкод mm:ss или hh:mm:ss: 00:00, 01:35, 1:02:10 */
const TIMECODE = /(?<!\d)(?:(\d{1,2}):)?(\d{1,2}):(\d{2})(?!\d)/g

function timecodeToSeconds(hours: string | undefined, minutes: string, seconds: string): number | null {
  const mm = Number(minutes)
  const ss = Number(seconds)
  if (mm > 59 || ss > 59) return null
  return (hours ? Number(hours) : 0) * 3600 + mm * 60 + ss
}

/**
 * Описание видео с кликабельными таймкодами: обычный текст сохраняется как есть
 * (включая переносы строк), таймкоды становятся кнопками перемотки.
 */
export default function VideoDescription({ text, onSeek }: { text: string; onSeek: (seconds: number) => void }) {
  const parts: ReactNode[] = []
  let last = 0
  let i = 0
  for (const m of text.matchAll(TIMECODE)) {
    const seconds = timecodeToSeconds(m[1], m[2], m[3])
    if (m.index > last) parts.push(text.slice(last, m.index))
    if (seconds === null) {
      parts.push(m[0])
    } else {
      parts.push(
        <button
          key={`tc-${i}`}
          type="button"
          onClick={() => onSeek(seconds)}
          title={`Перемотать к ${m[0]}`}
          className="cursor-pointer font-mono text-[13px] font-semibold text-accent underline decoration-accent/60 underline-offset-4 transition-colors hover:decoration-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {m[0]}
        </button>,
      )
    }
    last = m.index + m[0].length
    i++
  }
  parts.push(text.slice(last))

  return (
    <p className="-mt-5 mb-8 max-w-[70ch] whitespace-pre-line text-sm leading-relaxed text-muted-foreground">
      {parts}
    </p>
  )
}
