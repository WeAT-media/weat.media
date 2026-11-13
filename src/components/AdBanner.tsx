import { useMemo, useState } from 'react'
import { Megaphone, Pause, Play } from 'lucide-react'
import { useStore } from '@/lib/store'
import { loadAds, safeAdImageSrc, type AdCreative } from '@/lib/ads'
import { safeHref } from '@/lib/safeUrl'

/** Рекламный слот. Premium-пользователи рекламу не видят вообще. */
export default function AdBanner() {
  const { isPremium } = useStore()
  const ad = useMemo(() => loadAds().find((a) => a.active), [])
  if (isPremium || !ad) return null
  return <AdView ad={ad} />
}

/** Сам баннер — и в статье, и как предпросмотр в рекламном кабинете */
export function AdView({ ad }: { ad: AdCreative }) {
  const src = ad.image ? safeAdImageSrc(ad.image.src) : null
  // GIF: при «уменьшении движения» в системе не крутим сами — по кнопке
  const reduce = typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  const [play, setPlay] = useState(!reduce)
  const href = safeHref(ad.url)

  return (
    <aside aria-label="Реклама" className="my-8 border border-border bg-secondary/50 p-6">
      <p className="meta flex flex-wrap items-center gap-2">
        <Megaphone size={12} className="text-accent" aria-hidden="true" />
        Реклама
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-5">
        {src && ad.image && (
          <div className="relative w-full shrink-0 overflow-hidden rounded-md border border-border bg-background sm:w-48">
            {ad.image.animated && !play ? (
              <button type="button" onClick={() => setPlay(true)} className="flex aspect-[4/3] w-full items-center justify-center gap-2 text-sm text-muted-foreground">
                <Play size={14} aria-hidden="true" /> Показать анимацию
              </button>
            ) : (
              <img src={src} alt={ad.image.alt} loading="lazy" decoding="async" referrerPolicy="no-referrer" className="aspect-[4/3] w-full object-cover" />
            )}
            {ad.image.animated && play && (
              <button type="button" onClick={() => setPlay(false)} aria-label="Остановить анимацию" className="absolute right-1.5 top-1.5 rounded-full bg-background/80 p-1">
                <Pause size={12} aria-hidden="true" />
              </button>
            )}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <p className="text-lg font-extrabold leading-snug tracking-tight">{ad.title}</p>
          {ad.text && <p className="mt-1.5 text-[15px] leading-relaxed">{ad.text}</p>}
        </div>
        {href && (
          <a href={href} target="_blank" rel="noopener noreferrer sponsored" className="btn-ghost shrink-0 !px-4 !py-2">
            {ad.cta || 'Перейти'}
          </a>
        )}
      </div>
      {/* служебное: маркировка обязательна, но не должна спорить с объявлением */}
      <p className="mt-4 text-[10px] leading-snug text-muted-foreground/70">
        {ad.advertiser} · erid: {ad.erid} · Реклама помогает поддерживать инфраструктуру; в Premium её нет.
      </p>
    </aside>
  )
}
