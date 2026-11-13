import type { CalloutTone } from '@/types/types'

const toneStyles: Record<CalloutTone, string> = {
  info: 'border-l-blue-500 bg-blue-500/10',
  success: 'border-l-green-500 bg-green-500/10',
  warning: 'border-l-yellow-500 bg-yellow-500/10',
  danger: 'border-l-red-500 bg-red-500/10',
}

function isTone(x: unknown): x is CalloutTone {
  return x === 'info' || x === 'success' || x === 'warning' || x === 'danger'
}

/**
 * Безопасный рендер callout-блока: raw — JSON из ```callout фенса
 * (src/lib/customBlocks.ts). Никакого arbitrary HTML: текст выводится
 * React'ом как строка, тон и иконка валидируются по белому списку.
 */
export default function CalloutView({ raw }: { raw: string }) {
  let icon = '💡'
  let tone: CalloutTone = 'info'
  let text = raw
  try {
    const parsed = JSON.parse(raw) as { icon?: unknown; tone?: unknown; text?: unknown }
    if (typeof parsed.icon === 'string' && parsed.icon.length <= 4) icon = parsed.icon
    if (isTone(parsed.tone)) tone = parsed.tone
    if (typeof parsed.text === 'string') text = parsed.text
  } catch {
    /* не JSON — показываем как обычный текст заметки */
  }
  return (
    <div className={`my-8 flex gap-3 rounded-md border border-border border-l-4 p-4 ${toneStyles[tone]}`}>
      <span className="text-lg leading-snug" aria-hidden="true">
        {icon}
      </span>
      <p className="whitespace-pre-line text-[15px] leading-relaxed">{text}</p>
    </div>
  )
}
