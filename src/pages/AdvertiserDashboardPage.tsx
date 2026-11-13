import { useState } from 'react'
import { Link } from 'react-router'
import { ArrowLeft, Check, Clock, LineChart, Lock, Pencil, Pin, Plus } from 'lucide-react'
import Reveal from '@/components/Reveal'
import { AdView } from '@/components/AdBanner'
import { useStore } from '@/lib/store'
import { countryLabel } from '@/lib/api'
import {
  AD_AUDIENCE_LABEL,
  AD_STATUSES,
  AD_STATUS_LABEL,
  PIN_APPROVAL_LABEL,
  acceptCounter,
  launched,
  loadAds,
  saveAds,
  type AdCreative,
} from '@/lib/ads'

const rub = (n: number) => `${n.toLocaleString('ru-RU')} ₽`
const when = (iso: string) => new Date(iso).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

function scheduleLine(a: AdCreative): string | null {
  const s = a.schedule
  if (!s) return null
  return [
    s.startsAt && `с ${when(s.startsAt)}`,
    s.endsAt && `до ${when(s.endsAt)}`,
    s.hours && `в ${String(s.hours.from).padStart(2, '0')}:00–${String(s.hours.to).padStart(2, '0')}:00`,
  ]
    .filter(Boolean)
    .join(' · ')
}

function geoLine(a: AdCreative): string {
  const parts = [
    a.geo.residence.length ? `живут: ${a.geo.residence.map((c) => countryLabel(c)).join(', ')}` : '',
    a.geo.registration.length ? `рег.: ${a.geo.registration.map((c) => countryLabel(c)).join(', ')}` : '',
  ].filter(Boolean)
  return parts.length ? parts.join(' · ') : 'все страны'
}

/**
 * Кабинет рекламодателя: только для вошедших. Свои креативы — как их видят читатели, статусы и расписание;
 * незапущенные можно править; закрепления — что ждёт согласования автора и что ждёт вашего ответа.
 * Демо: креативы хранятся в этом браузере, списаний нет.
 */
export default function AdvertiserDashboardPage() {
  const { user } = useStore()
  const [ads, setAds] = useState<AdCreative[]>(loadAds)

  // гость видит только приглашение войти — креативы и суммы привязаны к аккаунту
  if (!user) {
    return (
      <div className="mx-auto max-w-[720px] px-5 py-24 text-center">
        <Lock size={22} className="mx-auto text-accent" aria-hidden="true" />
        <p className="meta mt-4">Личный кабинет рекламодателя</p>
        <h1 className="mt-4 text-3xl font-extrabold tracking-tight">Нужна авторизация</h1>
        <p className="mx-auto mt-3 max-w-[48ch] text-muted-foreground">
          Креативы и закрепления привязаны к аккаунту. Войдите — вернём вас сюда сразу после входа.
        </p>
        <Link to="/login?returnTo=/ads/dashboard" className="btn-primary mt-8">
          Войти
        </Link>
      </div>
    )
  }

  const mine = ads.filter((a) => a.owner === user.handle)
  const pins = mine.filter((a) => a.pinnedTo && (a.pinnedTo.approval === 'pending' || a.pinnedTo.approval === 'countered'))
  const accept = (a: AdCreative) => {
    const next = ads.map((x) => (x.id === a.id ? acceptCounter(x) : x))
    setAds(next)
    saveAds(next)
  }

  return (
    <div className="mx-auto max-w-[960px] px-5 pb-24 md:px-8">
      <div className="pt-10">
        <Link
          to="/ads"
          className="inline-flex items-center gap-2 font-mono text-[12px] font-semibold uppercase tracking-[0.08em] text-muted-foreground transition-colors hover:text-accent"
        >
          <ArrowLeft size={13} aria-hidden="true" /> Рекламодателям
        </Link>
        <p className="meta mt-8 flex items-center gap-1.5">
          <LineChart size={12} aria-hidden="true" /> Кабинет · @{user.handle}
        </p>
        <h1 className="mt-2 text-4xl font-extrabold tracking-tight md:text-5xl">Личный кабинет рекламодателя</h1>
        <p className="mt-4 max-w-[64ch] text-[15px] leading-relaxed text-muted-foreground">
          Ваши креативы так, как их видят читатели. Пока креатив не показывался, его можно править — например, сменить
          картинку.
        </p>
        <Link to="/ads" className="btn-primary mt-6">
          <Plus size={14} aria-hidden="true" /> Новый креатив
        </Link>
      </div>

      {/* сводка по статусам */}
      <Reveal className="mt-10 flex flex-wrap gap-2">
        {AD_STATUSES.map((s) => {
          const n = mine.filter((a) => a.status === s).length
          return n ? (
            <span key={s} className="rounded-full border border-border px-3 py-1 font-mono text-[11px] font-semibold">
              {AD_STATUS_LABEL[s]} · {n}
            </span>
          ) : null
        })}
      </Reveal>

      {/* согласование закреплений */}
      <Reveal className="mt-8 border border-border bg-secondary/40 p-5">
        <h2 className="inline-flex items-center gap-2 font-mono text-[13px] font-bold uppercase tracking-[0.12em]">
          <Pin size={13} aria-hidden="true" /> На согласовании · {pins.length}
        </h2>
        {pins.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">Закреплений, ждущих ответа, нет.</p>
        ) : (
          <ul className="mt-3">
            {pins.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-border/70 py-3 text-sm last:border-b-0">
                <span>
                  <b>{a.title || 'без названия'}</b> → «{a.pinnedTo!.title}» у @{a.pinnedTo!.author}: вы предложили {rub(a.pinnedTo!.offer)}
                  {a.pinnedTo!.approval === 'countered' && (
                    <>
                      , автор просит <b>{rub(a.pinnedTo!.counter!)}</b>
                    </>
                  )}
                </span>
                {a.pinnedTo!.approval === 'countered' ? (
                  <span className="flex gap-2">
                    <button type="button" onClick={() => accept(a)} className="btn-primary !px-3 !py-1.5 !text-[11px]">
                      <Check size={12} aria-hidden="true" /> Принять {rub(a.pinnedTo!.counter!)}
                    </button>
                    <Link to={`/ads?edit=${a.id}`} className="btn-ghost !px-3 !py-1.5 !text-[11px]">
                      Изменить предложение
                    </Link>
                  </span>
                ) : (
                  <span className="meta inline-flex items-center gap-1">
                    <Clock size={11} aria-hidden="true" /> {PIN_APPROVAL_LABEL.pending}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </Reveal>

      {/* креативы */}
      <section aria-label="Ваши креативы" className="mt-10">
        <h2 className="text-xl font-extrabold tracking-tight">Ваши креативы · {mine.length}</h2>
        {mine.length === 0 ? (
          <p className="rule mt-4 py-8 text-sm text-muted-foreground">
            У вас пока нет креативов. <Link to="/ads" className="text-accent hover:underline">Создайте первый</Link> — он появится здесь.
          </p>
        ) : (
          mine.map((a) => {
            const editable = !launched(a)
            const sched = scheduleLine(a)
            return (
              <Reveal key={a.id}>
                <article className="rule py-6">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="meta !normal-case tracking-normal">
                      <b className="uppercase tracking-[0.06em] text-foreground">{AD_STATUS_LABEL[a.status]}</b> · {AD_AUDIENCE_LABEL[a.audience]} · {geoLine(a)}
                      {sched && ` · ${sched}`}
                      {a.pinnedTo && ` · закрепление: ${PIN_APPROVAL_LABEL[a.pinnedTo.approval]}`}
                    </p>
                    {editable ? (
                      <Link to={`/ads?edit=${a.id}`} className="btn-ghost !px-3 !py-1.5 !text-[11px]">
                        <Pencil size={12} aria-hidden="true" /> Редактировать
                      </Link>
                    ) : (
                      <span className="meta inline-flex items-center gap-1" title="Креатив уже показывался — содержимое закрыто">
                        <Lock size={11} aria-hidden="true" /> уже показывался{a.launchedAt && ` · с ${when(a.launchedAt)}`}
                      </span>
                    )}
                  </div>
                  <AdView ad={a} />
                </article>
              </Reveal>
            )
          })
        )}
      </section>

      <p className="meta mt-8">Демо-кабинет: креативы хранятся в этом браузере, списаний и платежей нет.</p>
    </div>
  )
}
