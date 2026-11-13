import { useState } from 'react'
import { Link } from 'react-router'
import { Check, Pin, X } from 'lucide-react'
import { useStore } from '@/lib/store'
import Reveal from '@/components/Reveal'
import { AdView } from '@/components/AdBanner'
import { remoteId } from '@/lib/remoteFeed'
import { BASE_CPM, PIN_APPROVAL_LABEL, PIN_MULTIPLIER, decidePin, loadAds, pinAuthorShare, saveAds, type AdCreative } from '@/lib/ads'

/**
 * Запросы рекламодателей закрепить креатив за вашим постом. Закрепление пишется в запись поста в вашем PDS
 * и бессрочно — поэтому без вашего согласия оно не появится и не будет оплачено.
 * Демо: запросы видны в том же браузере, где их создал рекламодатель; доставку автору даст сервер рекламы.
 */
export default function AdPinsSettingsPage() {
  const { user, isPremium } = useStore()
  const share = pinAuthorShare(isPremium)
  const pinPrice = BASE_CPM * PIN_MULTIPLIER
  const yours = Math.floor(pinPrice * share)
  const [ads, setAds] = useState<AdCreative[]>(loadAds)
  const mine = ads.filter((a) => a.pinnedTo && user && a.pinnedTo.author === user.handle)
  const pending = mine.filter((a) => a.pinnedTo!.approval === 'pending')
  const decided = mine.filter((a) => a.pinnedTo!.approval !== 'pending')

  const decide = (id: string, approve: boolean) => {
    const next = decidePin(ads, id, approve)
    setAds(next)
    saveAds(next)
  }

  return (
    <Reveal className="border border-border bg-secondary/40 p-6">
      <section aria-label="Реклама в постах">
        <h2 className="inline-flex items-center gap-2 font-mono text-[13px] font-bold uppercase tracking-[0.12em]">
          <Pin size={13} aria-hidden="true" /> Реклама в постах
        </h2>
        <p className="mt-3 max-w-[64ch] text-sm leading-relaxed text-muted-foreground">
          Рекламодатель может попросить закрепить креатив за вашим постом. Закрепление записывается в сам пост в вашем
          репозитории (PDS): оно публично и бессрочно — копии остаются у ретрансляторов и индексов сети. Поэтому без
          вашего согласия креатив в посте не появится и не будет оплачен.
        </p>
        <p className="mt-3 text-sm">
          Закрепление стоит рекламодателю <b>{pinPrice.toLocaleString('ru-RU')} ₽</b> разово ({BASE_CPM} ₽ × {PIN_MULTIPLIER}). Вам —{' '}
          <b>{Math.round(share * 100)}%: {yours.toLocaleString('ru-RU')} ₽</b>
          {isPremium ? ' (Premium-автор)' : ' · с Premium — 99%'}; остальное — инфраструктура площадки.
        </p>

        <h3 className="mt-6 text-sm font-semibold">Ждут решения · {pending.length}</h3>
        {pending.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">Новых запросов нет.</p>
        ) : (
          pending.map((a) => (
            <div key={a.id} className="mt-4 border-b border-border/70 pb-5">
              <p className="text-sm">
                <b>{a.advertiser}</b> просит закрепить за постом{' '}
                <Link to={`/article/${remoteId(a.pinnedTo!.uri)}`} className="font-semibold text-accent hover:underline">
                  «{a.pinnedTo!.title}»
                </Link>
              </p>
              <AdView ad={a} />
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => decide(a.id, true)} className="btn-primary">
                  <Check size={14} aria-hidden="true" /> Согласен — закрепить бессрочно
                </button>
                <button type="button" onClick={() => decide(a.id, false)} className="btn-ghost">
                  <X size={14} aria-hidden="true" /> Отказать
                </button>
              </div>
            </div>
          ))
        )}

        {decided.length > 0 && (
          <>
            <h3 className="mt-8 text-sm font-semibold">Решённые</h3>
            <ul className="mt-2">
              {decided.map((a) => (
                <li key={a.id} className="flex flex-wrap justify-between gap-2 border-b border-border/70 py-2.5 text-sm last:border-b-0">
                  <span>
                    {a.title} · <span className="text-muted-foreground">{a.advertiser} → «{a.pinnedTo!.title}»</span>
                  </span>
                  <span className={`meta ${a.pinnedTo!.approval === 'approved' ? 'text-accent' : ''}`}>{PIN_APPROVAL_LABEL[a.pinnedTo!.approval]}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </Reveal>
  )
}
