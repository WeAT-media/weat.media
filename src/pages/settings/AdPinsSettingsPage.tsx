import { useState } from 'react'
import { Link } from 'react-router'
import { Check, Pin, Send, X } from 'lucide-react'
import { useStore } from '@/lib/store'
import Reveal from '@/components/Reveal'
import { AdView } from '@/components/AdBanner'
import FeeNote from '@/components/FeeNote'
import { remoteId } from '@/lib/remoteFeed'
import { MIN_PIN_OFFER, PIN_APPROVAL_LABEL, counterPin, decidePin, loadAds, pinAuthorShare, saveAds, type AdCreative } from '@/lib/ads'

const rub = (n: number) => `${n.toLocaleString('ru-RU')} ₽`

/**
 * Запросы рекламодателей закрепить креатив за вашим постом. Закрепление пишется в запись поста в вашем PDS
 * и бессрочно — поэтому без вашего согласия оно не появится и не будет оплачено. Сумму можно не принять,
 * а назвать свою: тогда решает рекламодатель.
 * Демо: запросы видны в том же браузере, где их создал рекламодатель; доставку автору даст сервер рекламы.
 */
export default function AdPinsSettingsPage() {
  const { user, isPremium } = useStore()
  const [ads, setAds] = useState<AdCreative[]>(loadAds)
  const [counters, setCounters] = useState<Record<string, string>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const share = pinAuthorShare(isPremium)
  const yours = (offer: number) => Math.floor(offer * share)

  const mine = ads.filter((a) => a.pinnedTo && user && a.pinnedTo.author === user.handle)
  const pending = mine.filter((a) => a.pinnedTo!.approval === 'pending')
  const countered = mine.filter((a) => a.pinnedTo!.approval === 'countered')
  const decided = mine.filter((a) => a.pinnedTo!.approval === 'approved' || a.pinnedTo!.approval === 'rejected')

  const commit = (next: AdCreative[]) => {
    setAds(next)
    saveAds(next)
  }
  const propose = (a: AdCreative) => {
    const price = Math.floor(Number(counters[a.id]) || 0)
    if (price < MIN_PIN_OFFER) return setErrors((e) => ({ ...e, [a.id]: `Не меньше ${rub(MIN_PIN_OFFER)}` }))
    if (price === a.pinnedTo!.offer) return setErrors((e) => ({ ...e, [a.id]: 'Это та же сумма — просто согласитесь' }))
    setErrors((e) => ({ ...e, [a.id]: '' }))
    commit(counterPin(ads, a.id, price))
  }

  const postLink = (a: AdCreative) => (
    <Link to={`/article/${remoteId(a.pinnedTo!.uri)}`} className="font-semibold text-accent hover:underline">
      «{a.pinnedTo!.title}»
    </Link>
  )

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
          Сумму предлагает рекламодатель — от {rub(MIN_PIN_OFFER)}, без потолка. Вам — <b>{Math.round(share * 100)}%*</b>
          {isPremium ? ' (Premium-автор)' : ' · с Premium — 99%*'}, остальное — инфраструктура площадки. Мало — назовите свою
          цену.
        </p>
        <FeeNote className="mt-1" />

        <h3 className="mt-6 text-sm font-semibold">Ждут вашего решения · {pending.length}</h3>
        {pending.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">Новых запросов нет.</p>
        ) : (
          pending.map((a) => (
            <div key={a.id} className="mt-4 border-b border-border/70 pb-5">
              <p className="text-sm">
                <b>{a.advertiser}</b> предлагает <b>{rub(a.pinnedTo!.offer)}</b> (вам — {rub(yours(a.pinnedTo!.offer))}*) за
                закрепление за постом {postLink(a)}
              </p>
              <AdView ad={a} />
              <div className="flex flex-wrap items-start gap-2">
                <button type="button" onClick={() => commit(decidePin(ads, a.id, true))} className="btn-primary">
                  <Check size={14} aria-hidden="true" /> Согласен — закрепить бессрочно
                </button>
                <button type="button" onClick={() => commit(decidePin(ads, a.id, false))} className="btn-ghost">
                  <X size={14} aria-hidden="true" /> Отказать
                </button>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <label className="sr-only" htmlFor={`counter-${a.id}`}>Своя цена, ₽</label>
                <input
                  id={`counter-${a.id}`}
                  type="number"
                  min={MIN_PIN_OFFER}
                  step={1000}
                  placeholder={`Своя цена, от ${MIN_PIN_OFFER.toLocaleString('ru-RU')}`}
                  value={counters[a.id] ?? ''}
                  onChange={(e) => setCounters((c) => ({ ...c, [a.id]: e.target.value }))}
                  className="w-56 rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
                <button type="button" onClick={() => propose(a)} className="btn-ghost">
                  <Send size={13} aria-hidden="true" /> Предложить
                </button>
                {Number(counters[a.id]) >= MIN_PIN_OFFER && (
                  <span className="meta !normal-case tracking-normal">вам — {rub(yours(Math.floor(Number(counters[a.id]))))}*</span>
                )}
              </div>
              {errors[a.id] && <p role="alert" className="mt-1 text-sm text-destructive">{errors[a.id]}</p>}
            </div>
          ))
        )}

        {countered.length > 0 && (
          <>
            <h3 className="mt-8 text-sm font-semibold">Ждут ответа рекламодателя · {countered.length}</h3>
            <ul className="mt-2">
              {countered.map((a) => (
                <li key={a.id} className="border-b border-border/70 py-2.5 text-sm last:border-b-0">
                  {a.advertiser} → {postLink(a)}: предложили {rub(a.pinnedTo!.offer)}, вы назвали{' '}
                  <b>{rub(a.pinnedTo!.counter!)}</b>
                </li>
              ))}
            </ul>
          </>
        )}

        {decided.length > 0 && (
          <>
            <h3 className="mt-8 text-sm font-semibold">Решённые</h3>
            <ul className="mt-2">
              {decided.map((a) => (
                <li key={a.id} className="flex flex-wrap justify-between gap-2 border-b border-border/70 py-2.5 text-sm last:border-b-0">
                  <span>
                    {a.title} · <span className="text-muted-foreground">{a.advertiser} → «{a.pinnedTo!.title}» · {rub(a.pinnedTo!.offer)}</span>
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
