import { Gavel, MessageSquareWarning, Scale, TrendingUp, Wrench, type LucideIcon } from 'lucide-react'

/** Иконка коллегии по её специализации */
const ICONS: Record<string, LucideIcon> = {
  'collegium-fraud': TrendingUp,
  'collegium-tech': Wrench,
  'collegium-law': Scale,
  'collegium-tone': MessageSquareWarning,
  'collegium-main': Gavel,
}

export default function CollegiumIcon({ id, size = 16, className = '' }: { id: string; size?: number; className?: string }) {
  const Icon = ICONS[id] ?? Gavel
  const box = Math.round(size * 2)
  return (
    <span
      aria-hidden="true"
      className={`inline-flex shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent ${className}`}
      style={{ width: box, height: box }}
    >
      <Icon size={size} />
    </span>
  )
}
