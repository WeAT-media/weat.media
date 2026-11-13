import { useMemo } from 'react'
import { Link } from 'react-router'
import { ArrowRight } from 'lucide-react'
import { parseActionButton } from '@/lib/actionButton'

/** Кнопка с действием в статье: внутренние пути — переход по сайту, внешние — новая вкладка */
export default function ActionButtonView({ raw }: { raw: string }) {
  const b = useMemo(() => parseActionButton(raw), [raw])
  if (!b) return null
  const cls = `${b.variant === 'primary' ? 'btn-primary' : 'btn-ghost'} !px-6 !py-3 !text-sm`
  const inner = (
    <>
      {b.label} <ArrowRight size={15} aria-hidden="true" />
    </>
  )
  return (
    <div className="my-8 flex flex-col items-start gap-2">
      {b.url.startsWith('/') ? (
        <Link to={b.url} className={cls}>{inner}</Link>
      ) : (
        <a href={b.url} target="_blank" rel="noopener noreferrer" className={cls}>
          {inner}
        </a>
      )}
      {b.note && <p className="meta !normal-case tracking-normal">{b.note}</p>}
    </div>
  )
}
