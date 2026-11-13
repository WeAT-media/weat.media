import { useEffect, useMemo, useState } from 'react'
import { Megaphone, Pause, Pin, Play } from 'lucide-react'
import { useStore } from '@/lib/store'
import { api } from '@/lib/api'
import { isLive, loadAds, matchesGeo, pinLive, safeAdImageSrc, type AdCreative } from '@/lib/ads'
import { safeHref } from '@/lib/safeUrl'

/** страна гостя по IP — одна на вкладку (у гостя нет страны регистрации) */
let geoOnce: Promise<string | undefined> | null = null

/**
 * Рекламный слот. Premium-пользователи рекламу не видят вообще.
 * articleUri — пост: закреплённый за ним креатив важнее остальных; закреплённые в других постах не показываем.
 */
export default function AdBanner({ articleUri }: { articleUri?: string }) {
  const { isPremium, user } = useStore()
  const [guestCountry, setGuestCountry] = useState<string | undefined>()
  useEffect(() => {
    if (user) return
    geoOnce ??= api.geo().then((g) => g.country, () => undefined)
    let alive = true
    geoOnce.then((c) => alive && setGuestCountry(c))
    return () => {
      alive = false
    }
  }, [user])
  const viewer = user ? { residence: user.residenceCountry ?? user.signupCountry, registration: user.signupCountry } : { residence: guestCountry }
  const ad = useMemo(() => {
    const live = loadAds().filter(isLive)
    // закреплённый — только с согласия автора; ждущий согласия не показывается нигде
    const pinned = articleUri ? live.find((a) => pinLive(a) && a.pinnedTo!.uri === articleUri) : undefined
    return pinned ?? live.find((a) => !a.pinnedTo && matchesGeo(a.geo, viewer))
    // viewer — из стора и ответа geo: пересчёт по их значениям
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [articleUri, viewer.residence, viewer.registration])
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
        {ad.pinnedTo && (
          <span className="inline-flex items-center gap-1">
            · <Pin size={10} aria-hidden="true" /> закреплено за постом
          </span>
        )}
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
      {/* служебное: маркировка (если показ в РФ) не должна спорить с объявлением */}
      <p className="mt-4 text-[10px] leading-snug text-muted-foreground/70">
        {ad.advertiser}
        {ad.erid && <> · erid: {ad.erid} · маркировка по 38-ФЗ «О рекламе»</>}
        {' · '}Реклама помогает поддерживать инфраструктуру; в Premium её нет.
      </p>
    </aside>
  )
}
