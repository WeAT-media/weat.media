import { useState, type FormEvent } from 'react'
import { ImagePlus, Pin, Trash2 } from 'lucide-react'
import { Link } from 'react-router'
import { AdView } from '@/components/AdBanner'
import CountrySelect from '@/components/CountrySelect'
import FeeNote from '@/components/FeeNote'
import { useStore } from '@/lib/store'
import { countryLabel } from '@/lib/api'
import {
  AD_IMAGE_MAX_BYTES,
  AD_AUDIENCE_LABEL,
  AD_STATUS_LABEL,
  BASE_CPM,
  HIDE_FROM_BOARD_MARKUP,
  MIN_PIN_OFFER,
  acceptCounter,
  PIN_APPROVAL_LABEL,
  adPrice,
  launched,
  loadAds,
  needsErid,
  readImageFile,
  safeAdImageSrc,
  saveAds,
  type AdAudience,
  type AdCreative,
  type AdStatus,
} from '@/lib/ads'
import { safeHref } from '@/lib/safeUrl'

const inputCls =
  'w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

const newErid = () => `2Vtz${Math.random().toString(36).slice(2, 9).toUpperCase()}`

const HOURS = Array.from({ length: 24 }, (_, h) => h)

/** ISO ↔ значение datetime-local (местное время, без секунд) */
const toLocalInput = (iso?: string) => {
  if (!iso) return ''
  const d = new Date(iso)
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
}
const fromLocalInput = (v: string) => (v ? new Date(v).toISOString() : undefined)

const blank = (advertiser: string): AdCreative => ({
  id: `ad-${Date.now()}`,
  advertiser,
  title: '',
  text: '',
  url: 'https://',
  cta: 'Перейти',
  status: 'draft',
  audience: 'all',
  geo: { residence: [], registration: [] },
  hiddenFromBoard: false,
  createdAt: new Date().toISOString(),
})

/** Креативы: текст, ссылка, картинка или GIF, гео, маркировка; предпросмотр — тот же баннер, что увидят читатели */
/** initialId — открыть этот креатив (ссылка «Редактировать» из кабинета /ads/dashboard) */
export default function AdCreativeEditor({ onChange, initialId }: { onChange?: (ads: AdCreative[]) => void; initialId?: string }) {
  const { articles, user } = useStore()
  const [ads, setAds] = useState<AdCreative[]>(loadAds)
  const [draft, setDraft] = useState<AdCreative>(() => ads.find((a) => a.id === initialId) ?? ads[0]!)
  // уже показывался — содержимое закрыто: маркировка и отчёты привязаны к нему; меняются статус и расписание
  const locked = launched(draft)
  const [imageUrl, setImageUrl] = useState('')
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)

  const set = (p: Partial<AdCreative>) => {
    setDraft((d) => ({ ...d, ...p }))
    setSaved(false)
  }
  const open = (a: AdCreative) => {
    setDraft(a)
    setImageUrl('')
    setError('')
    setSaved(false)
  }

  const geo = draft.geo
  const marked = needsErid(geo)
  const price = adPrice(draft)
  // закрепить можно за постом из индекса: закрепление уходит в его запись в PDS
  const pinnable = articles.filter((a) => a.fromIndex && a.atUri)

  const pickFile = async (file: File | undefined) => {
    if (!file) return
    setError('')
    try {
      const img = await readImageFile(file)
      set({ image: { ...img, alt: draft.image?.alt ?? '' } })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось загрузить картинку')
    }
  }

  const useUrl = () => {
    const src = imageUrl.trim()
    if (!safeAdImageSrc(src)) return setError('Ссылка на картинку — только https://')
    setError('')
    set({ image: { src, alt: draft.image?.alt ?? '', animated: /\.gif(\?|$)/i.test(src) } })
  }

  const save = (e: FormEvent) => {
    e.preventDefault()
    if (!safeHref(draft.url) || !/^https?:/.test(draft.url)) return setError('Ссылка объявления — https://…')
    if (draft.image && !draft.image.alt.trim()) return setError('Опишите картинку (альтернативный текст)')
    if (!draft.advertiser.trim()) return setError('Укажите рекламодателя')
    if (draft.status === 'scheduled' && !(draft.schedule?.startsAt && Date.parse(draft.schedule.startsAt) > Date.now()) && !locked)
      return setError('«Запланирован»: укажите дату и время старта в будущем')
    if (draft.schedule?.startsAt && draft.schedule.endsAt && draft.schedule.endsAt <= draft.schedule.startsAt) return setError('Окончание — позже старта')
    if (draft.pinnedTo && draft.pinnedTo.offer < MIN_PIN_OFFER) return setError(`Закрепление — от ${MIN_PIN_OFFER.toLocaleString('ru-RU')} ₽`)
    if (marked && !draft.erid?.trim()) return setError('Показ в РФ: нужен erid (маркировка по 38-ФЗ). Получите его в ОРД или уберите РФ из гео')
    setError('')
    // владелец — кто сохранил: креатив появится в его кабинете /ads/dashboard
    const goesLive = (draft.status === 'running' || draft.status === 'prolonged') && !draft.launchedAt
    const next: AdCreative = {
      ...draft,
      geo,
      ...(draft.owner || !user ? {} : { owner: user.handle }),
      ...(goesLive ? { launchedAt: new Date().toISOString() } : {}),
      ...(marked ? {} : { erid: undefined }),
    }
    const list = ads.some((a) => a.id === next.id) ? ads.map((a) => (a.id === next.id ? next : a)) : [next, ...ads]
    setAds(list)
    saveAds(list)
    onChange?.(list)
    setDraft(next)
    setSaved(true)
  }

  return (
    <section className="mt-10 border border-border p-6" aria-labelledby="creative-h">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="creative-h" className="text-xl font-extrabold tracking-tight">Креатив</h2>
        <div className="flex flex-wrap gap-2">
          {ads.map((a) => (
            <button key={a.id} type="button" onClick={() => open(a)} className={`btn-ghost !px-3 !py-1.5 !text-[11px] ${a.id === draft.id ? '!border-accent !text-accent' : ''}`}>
              {a.title || 'без названия'} · {AD_STATUS_LABEL[a.status].toLowerCase()}
            </button>
          ))}
          <button type="button" onClick={() => open(blank(draft.advertiser))} className="btn-ghost !px-3 !py-1.5 !text-[11px]">+ Новый</button>
        </div>
      </div>

      <div className="mt-6 grid gap-8 lg:grid-cols-2">
        <form onSubmit={save} className="grid gap-3">
          {locked && (
            <p className="rounded-md border border-border bg-secondary/60 p-3 text-sm">
              Креатив уже показывался — текст, картинку и ссылку не поменять: к нему привязаны маркировка и отчёты.
              Можно сменить статус и расписание или <button type="button" onClick={() => open(blank(draft.advertiser))} className="cursor-pointer font-semibold text-accent hover:underline">создать новый</button>.
            </p>
          )}
          <fieldset disabled={locked} className="grid gap-3 disabled:opacity-60">
          <label className="grid gap-1 text-sm font-semibold">Рекламодатель
            <input className={inputCls} value={draft.advertiser} onChange={(e) => set({ advertiser: e.target.value })} placeholder="ООО «Ромашка», ИНН 7700000000" maxLength={120} required />
          </label>
          <label className="grid gap-1 text-sm font-semibold">Заголовок
            <input className={inputCls} value={draft.title} onChange={(e) => set({ title: e.target.value })} maxLength={90} required />
          </label>
          <label className="grid gap-1 text-sm font-semibold">Текст
            <textarea className={inputCls} rows={2} value={draft.text} onChange={(e) => set({ text: e.target.value })} maxLength={220} />
          </label>
          <div className="grid gap-3 sm:grid-cols-[1fr_140px]">
            <label className="grid gap-1 text-sm font-semibold">Ссылка
              <input className={inputCls} type="url" value={draft.url} onChange={(e) => set({ url: e.target.value })} required />
            </label>
            <label className="grid gap-1 text-sm font-semibold">Кнопка
              <input className={inputCls} value={draft.cta} onChange={(e) => set({ cta: e.target.value })} maxLength={24} />
            </label>
          </div>

          <fieldset className="grid gap-2 rounded-md border border-border p-3">
            <legend className="px-1 text-sm font-semibold">Картинка или GIF — по желанию</legend>
            <label className="btn-ghost w-fit cursor-pointer !px-3 !py-1.5 !text-[11px]">
              <ImagePlus size={13} aria-hidden="true" /> Загрузить файл
              <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="sr-only" onChange={(e) => void pickFile(e.target.files?.[0])} />
            </label>
            <div className="flex gap-2">
              <input className={inputCls} value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} placeholder="или https://…/banner.gif" />
              <button type="button" onClick={useUrl} className="btn-ghost shrink-0 !px-3 !py-1.5 !text-[11px]">Взять</button>
            </div>
            <p className="meta !normal-case tracking-normal">PNG, JPEG, WebP или GIF до {AD_IMAGE_MAX_BYTES / 1024 / 1024} МБ · соотношение 4:3</p>
            {draft.image && (
              <>
                <label className="grid gap-1 text-sm font-semibold">Что на картинке (для незрячих и при отключённых картинках)
                  <input className={inputCls} value={draft.image.alt} onChange={(e) => set({ image: { ...draft.image!, alt: e.target.value } })} maxLength={150} required />
                </label>
                <button type="button" onClick={() => set({ image: undefined })} className="btn-ghost w-fit !px-3 !py-1.5 !text-[11px]">
                  <Trash2 size={12} aria-hidden="true" /> Убрать картинку
                </button>
              </>
            )}
          </fieldset>

          </fieldset>

          <label className="grid gap-1 text-sm font-semibold">Кому показывать
            <select className={inputCls} value={draft.audience} onChange={(e) => set({ audience: e.target.value as AdAudience })}>
              {(Object.keys(AD_AUDIENCE_LABEL) as AdAudience[]).map((k) => (
                <option key={k} value={k}>{AD_AUDIENCE_LABEL[k][0]!.toUpperCase() + AD_AUDIENCE_LABEL[k].slice(1)}</option>
              ))}
            </select>
          </label>

          {/* гео: две страны читателя — можно задать одну, обе или ни одной */}
          <fieldset className="grid gap-2 rounded-md border border-border p-3">
            <legend className="px-1 text-sm font-semibold">
              Гео · <Link to="/legal/register-and-residency" className="font-normal text-accent hover:underline">чем отличаются страны</Link>
            </legend>
            <div className="grid gap-1 text-sm">
              По стране резидентства
              <CountrySelect multiple label="Страны резидентства" placeholder="Любая страна" value={geo.residence} onChange={(residence) => set({ geo: { ...geo, residence } })} />
            </div>
            <div className="grid gap-1 text-sm">
              По стране регистрации
              <CountrySelect multiple label="Страны регистрации" placeholder="Любая страна" value={geo.registration} onChange={(registration) => set({ geo: { ...geo, registration } })} />
            </div>
            <p className="meta !normal-case tracking-normal">
              {geo.residence.length || geo.registration.length
                ? [
                    geo.residence.length ? `живут в: ${geo.residence.map((c) => countryLabel(c)).join(', ')}` : '',
                    geo.registration.length ? `зарегистрированы в: ${geo.registration.map((c) => countryLabel(c)).join(', ')}` : '',
                  ].filter(Boolean).join(' · и ')
                : 'показ во всех странах'}
              . Гостям без аккаунта — по стране IP как резидентства; страны регистрации у них нет.
            </p>
          </fieldset>

          {/* маркировка: только если креатив может показаться в РФ */}
          {marked ? (
            <div className="grid gap-1 rounded-md border border-accent/50 p-3">
              <label className="grid gap-1 text-sm font-semibold">erid — обязателен: показ в РФ (38-ФЗ «О рекламе»)
                <div className="flex gap-2">
                  <input className={inputCls} value={draft.erid ?? ''} onChange={(e) => set({ erid: e.target.value.trim() })} placeholder="токен из ОРД" maxLength={64} />
                  <button type="button" onClick={() => set({ erid: newErid() })} className="btn-ghost shrink-0 !px-3 !py-1.5 !text-[11px]">Демо-токен</button>
                </div>
              </label>
              <p className="meta !normal-case tracking-normal">Гео не задано или включает RU — креатив может попасть в РФ.</p>
            </div>
          ) : (
            <p className="meta !normal-case tracking-normal">Показ вне РФ — erid и маркировка по 38-ФЗ не нужны.</p>
          )}

          {/* расписание: старт (для «Запланирован»), конец и часы показа по времени читателя */}
          <fieldset className="grid gap-2 rounded-md border border-border p-3">
            <legend className="px-1 text-sm font-semibold">Расписание — по желанию</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="grid gap-1 text-sm">Старт
                <input
                  type="datetime-local"
                  className={inputCls}
                  disabled={locked}
                  value={toLocalInput(draft.schedule?.startsAt)}
                  onChange={(e) => set({ schedule: { ...draft.schedule, startsAt: fromLocalInput(e.target.value) } })}
                />
              </label>
              <label className="grid gap-1 text-sm">Окончание
                <input
                  type="datetime-local"
                  className={inputCls}
                  value={toLocalInput(draft.schedule?.endsAt)}
                  onChange={(e) => set({ schedule: { ...draft.schedule, endsAt: fromLocalInput(e.target.value) } })}
                />
              </label>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={!!draft.schedule?.hours}
                  onChange={(e) => set({ schedule: { ...draft.schedule, hours: e.target.checked ? { from: 9, to: 18 } : undefined } })}
                />
                Только в часы
              </label>
              {draft.schedule?.hours && (
                <>
                  <select className={`${inputCls} !w-24`} aria-label="С какого часа" value={draft.schedule.hours.from} onChange={(e) => set({ schedule: { ...draft.schedule, hours: { ...draft.schedule!.hours!, from: Number(e.target.value) } } })}>
                    {HOURS.map((h) => <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>)}
                  </select>
                  —
                  <select className={`${inputCls} !w-24`} aria-label="До какого часа" value={draft.schedule.hours.to} onChange={(e) => set({ schedule: { ...draft.schedule, hours: { ...draft.schedule!.hours!, to: Number(e.target.value) } } })}>
                    {HOURS.map((h) => <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>)}
                  </select>
                  <span className="meta !normal-case tracking-normal">по местному времени читателя</span>
                </>
              )}
            </div>
            <p className="meta !normal-case tracking-normal">Статус «Запланирован» включит показ сам, когда наступит старт.</p>
          </fieldset>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1 text-sm font-semibold">Статус
              <select className={inputCls} value={draft.status} onChange={(e) => set({ status: e.target.value as AdStatus })}>
                {/* «Закреплён» ставит только согласие автора поста — вручную не выбрать */}
                {(Object.keys(AD_STATUS_LABEL) as AdStatus[])
                  .filter((s) => s !== 'pinned' || draft.status === 'pinned')
                  .map((s) => (
                    <option key={s} value={s} disabled={s === 'pinned'}>{AD_STATUS_LABEL[s]}</option>
                  ))}
              </select>
            </label>
            <label className="flex items-end gap-2 pb-2 text-sm">
              <input type="checkbox" className="h-4 w-4 shrink-0" checked={draft.hiddenFromBoard} onChange={(e) => set({ hiddenFromBoard: e.target.checked })} />
              Скрыть с общей доски · +{HIDE_FROM_BOARD_MARKUP * 100}%
            </label>
          </div>

          {/* закрепление: запись в PDS поста — бессрочно; цену предлагает рекламодатель, решает автор */}
          <fieldset className="grid gap-2 rounded-md border border-border p-3">
            <legend className="inline-flex items-center gap-1 px-1 text-sm font-semibold">
              <Pin size={12} aria-hidden="true" /> Закрепить за постом · от {MIN_PIN_OFFER.toLocaleString('ru-RU')} ₽
            </legend>
            <select
              className={inputCls}
              value={draft.pinnedTo?.uri ?? ''}
              onChange={(e) => {
                const a = pinnable.find((x) => x.atUri === e.target.value)
                // новый пост — новый запрос: согласие автора нужно заново, «Закреплён» снимается до него
                set({
                  pinnedTo: a
                    ? { uri: a.atUri!, title: a.title, author: a.author.handle, offer: draft.pinnedTo?.offer ?? MIN_PIN_OFFER, approval: 'pending' }
                    : undefined,
                  ...(draft.status === 'pinned' ? { status: 'running' as const } : {}),
                })
              }}
            >
              <option value="">Не закреплять — показ по гео в любых статьях</option>
              {pinnable.map((a) => (
                <option key={a.atUri} value={a.atUri}>{a.title}</option>
              ))}
            </select>
            <p className="meta !normal-case tracking-normal">
              Почему от {MIN_PIN_OFFER.toLocaleString('ru-RU')} ₽: закрепление пишется в саму запись поста в репозитории автора
              (PDS). Запись публична, её копии расходятся по ретрансляторам и индексам сети — отозвать полностью нельзя. Это
              бессрочное размещение, а не показ на время. Сумму предлагаете вы, потолка нет: у известного автора место стоит
              дороже, а решает автор — согласиться, отказать или назвать свою цену. До согласия креатив в посте не
              показывается и не оплачивается.
            </p>
            {draft.pinnedTo && (
              <label className="grid gap-1 text-sm font-semibold">Ваше предложение автору, ₽
                <input
                  className={inputCls}
                  type="number"
                  min={MIN_PIN_OFFER}
                  step={1000}
                  value={draft.pinnedTo.offer}
                  onChange={(e) =>
                    // новая сумма — новый запрос автору: прежний ответ был на другую цену
                    set({
                      pinnedTo: { ...draft.pinnedTo!, offer: Math.floor(Number(e.target.value) || 0), counter: undefined, approval: 'pending' },
                      ...(draft.status === 'pinned' ? { status: 'running' as const } : {}),
                    })
                  }
                />
              </label>
            )}
            {draft.pinnedTo?.approval === 'countered' && draft.pinnedTo.counter && (
              <div className="flex flex-wrap items-center gap-3 rounded-md border border-accent/50 p-3 text-sm">
                <span>
                  @{draft.pinnedTo.author} готов закрепить за <b>{draft.pinnedTo.counter.toLocaleString('ru-RU')} ₽</b>
                </span>
                <button type="button" onClick={() => set(acceptCounter(draft))} className="btn-primary !px-3 !py-1.5 !text-[11px]">
                  Принять цену автора
                </button>
                <span className="meta !normal-case tracking-normal">или измените своё предложение выше</span>
              </div>
            )}
            {draft.pinnedTo && (
              <p className={`meta !normal-case tracking-normal ${draft.pinnedTo.approval === 'approved' ? 'text-accent' : draft.pinnedTo.approval === 'rejected' ? 'text-destructive' : ''}`}>
                @{draft.pinnedTo.author}: {PIN_APPROVAL_LABEL[draft.pinnedTo.approval]}
              </p>
            )}
          </fieldset>

          <div className="rounded-md bg-secondary/60 p-3 text-sm">
            <p>
              Ставка: <b>{price.cpm.toLocaleString('ru-RU')} ₽</b> за 1000 показов
              {draft.hiddenFromBoard && <span className="text-muted-foreground"> (база {BASE_CPM} ₽ + {HIDE_FROM_BOARD_MARKUP * 100}% за скрытие с доски)</span>}
            </p>
            {price.pin !== null && (
              <p className="mt-1">
                Закрепление за постом: <b>{price.pin.toLocaleString('ru-RU')} ₽</b> разово
                {draft.pinnedTo?.approval !== 'approved' && <span className="text-muted-foreground"> — после согласия автора</span>}
                <span className="block text-muted-foreground">автору поста — 90%*, Premium-автору — 99%*, площадке — остальное</span>
              </p>
            )}
            {price.pin !== null && <FeeNote className="mt-1" />}
            <p className="meta mt-1 !normal-case tracking-normal">демо-кабинет: списаний нет</p>
          </div>

          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <div className="flex items-center gap-3">
            <button type="submit" className="btn-primary">Сохранить</button>
            {saved && <span role="status" className="meta text-accent">сохранено</span>}
          </div>
        </form>

        <div>
          <p className="meta">Предпросмотр — так увидят читатели</p>
          <AdView key={`${draft.id}-${draft.image?.src.length ?? 0}`} ad={{ ...draft, ...(marked ? {} : { erid: undefined }) }} />
        </div>
      </div>
    </section>
  )
}
