import type { VerdictStatus } from '@/types/types'

const texts: Record<VerdictStatus, string> = {
  clear: '',
  trial: 'На рассмотрении',
  guilty: 'Осуждена',
  acquitted: 'Оправдана',
}

export default function Stamp({ verdict, small = false }: { verdict: VerdictStatus; small?: boolean }) {
  if (verdict === 'clear') return null
  const kind = verdict === 'guilty' ? 'guilty' : verdict === 'acquitted' ? 'acquitted' : 'trial'
  return (
    <span className={`stamp stamp--${kind} ${small ? 'stamp--sm' : 'text-sm'}`}>
      {texts[verdict]}
    </span>
  )
}
