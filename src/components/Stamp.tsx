import type { VerdictStatus } from '@/types/types'
import { useI18n } from '@/lib/i18n'

export default function Stamp({ verdict, small = false }: { verdict: VerdictStatus; small?: boolean }) {
  const { t } = useI18n()
  if (verdict === 'clear') return null
  const kind = verdict === 'guilty' ? 'guilty' : verdict === 'acquitted' ? 'acquitted' : 'trial'
  const text = verdict === 'guilty' ? t('condemned') : verdict === 'acquitted' ? t('acquitted') : t('underReview')
  return <span className={`stamp stamp--${kind} ${small ? 'stamp--sm' : 'text-sm'}`}>{text}</span>
}
