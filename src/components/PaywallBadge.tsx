import { Lock, LockOpen } from 'lucide-react'

/**
 * Замок платного контента в заголовке: закрытый — доступ не куплен,
 * открытый — покупка оформлена. Не полагается на цвет: разные иконки.
 */
export default function PaywallBadge({ hasPaywall, unlocked }: { hasPaywall: boolean; unlocked: boolean }) {
  if (!hasPaywall) return null
  const Icon = unlocked ? LockOpen : Lock
  const label = unlocked ? 'Платный контент, доступ открыт' : 'Платный контент, доступ закрыт'
  return (
    <span title={label} role="img" aria-label={label} className="ml-1.5 inline-flex shrink-0 align-baseline">
      <Icon size="0.7em" className={unlocked ? 'text-accent' : 'text-muted-foreground'} aria-hidden="true" />
    </span>
  )
}
