import { SITE_NAME } from '@/config/site'

/** Название площадки с выделенным «AT» (weAT.media): регистр букв сохраняется — это часть бренда */
export default function BrandName({ className, accentClassName = 'text-accent' }: { className?: string; accentClassName?: string }) {
  const i = SITE_NAME.indexOf('AT')
  if (i < 0) return <span className={className}>{SITE_NAME}</span>
  return (
    <span className={className}>
      <span className="sr-only">{SITE_NAME}</span>
      <span aria-hidden="true">{SITE_NAME.slice(0, i)}</span>
      <span aria-hidden="true" className={accentClassName}>AT</span>
      <span aria-hidden="true">{SITE_NAME.slice(i + 2)}</span>
    </span>
  )
}
