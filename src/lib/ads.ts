/**
 * Рекламные креативы: текст, ссылка, необязательная картинка или GIF.
 * Пока креативы живут в браузере рекламодателя (демо-кабинет); сервер рекламы — позже.
 */

export interface AdImage {
  /** https:// или data:image/… (загруженный файл) */
  src: string
  /** обязательный альтернативный текст: экранные чтецы и заблокированные картинки */
  alt: string
  animated: boolean
}

/**
 * история креатива: черновик, запланирован (старт по расписанию), идёт, на паузе, продлена
 * (новый срок после окончания), закреплён за постом, завершена
 */
export type AdStatus = 'draft' | 'scheduled' | 'running' | 'paused' | 'prolonged' | 'pinned' | 'finished'

export const AD_STATUS_LABEL: Record<AdStatus, string> = {
  draft: 'Черновик',
  scheduled: 'Запланирован',
  running: 'Идёт',
  paused: 'Пауза',
  prolonged: 'Продлена',
  pinned: 'Закреплён',
  finished: 'Завершена',
}

/**
 * Гео отдельно по двум странам читателя (ISO 3166-1 alpha-2). Пустой список — без ограничения по этой стране;
 * заданы оба — читатель должен подойти под оба. См. /legal/register-and-residency
 */
export interface AdGeo {
  residence: string[]
  registration: string[]
}

/** кому показывать: всем, только вошедшим или только гостям без аккаунта */
export type AdAudience = 'all' | 'registered' | 'anonymous'

export const AD_AUDIENCE_LABEL: Record<AdAudience, string> = {
  all: 'всем',
  registered: 'только зарегистрированным',
  anonymous: 'только гостям',
}

export interface AdCreative {
  id: string
  /** handle рекламодателя: его креативы — в кабинете /ads/dashboard */
  owner?: string
  audience: AdAudience
  /** идентификатор маркировки 38-ФЗ: обязателен, только если креатив может показаться в РФ (needsErid) */
  erid?: string
  /** рекламодатель: название или ИНН — обязательная часть маркировки */
  advertiser: string
  title: string
  text: string
  url: string
  cta: string
  image?: AdImage
  status: AdStatus
  geo: AdGeo
  /** скрыть с публичной доски креативов (за доплату HIDE_FROM_BOARD_MARKUP) */
  hiddenFromBoard: boolean
  /** когда показывать: старт (для «Запланирован»), конец и часы суток (по времени читателя) */
  schedule?: AdSchedule
  /** первый показ: после него содержимое креатива не меняется — маркировка и отчёты привязаны к нему */
  launchedAt?: string
  /**
   * Закреплён за постом: показывается только в нём (цена — предложение рекламодателя, от MIN_PIN_OFFER). Закрепление пишется
   * в запись поста в PDS автора и бессрочно — поэтому нужно согласие автора: до него креатив в посте не показан
   * и не оплачивается.
   */
  pinnedTo?: PinRequest
  createdAt: string
}

/**
 * Доля автора поста с закрепления — как с продаж (server/src/lava.ts): 90%, у Premium-автора 99%.
 * Пост — его, и бессрочное место в нём — тоже.
 */
export const pinAuthorShare = (premium: boolean) => (premium ? 0.99 : 0.9)

/** pending — ждёт автора; countered — автор предложил свою цену, ждёт рекламодателя */
export type PinApproval = 'pending' | 'countered' | 'approved' | 'rejected'

export const PIN_APPROVAL_LABEL: Record<PinApproval, string> = {
  pending: 'ждёт согласия автора',
  countered: 'автор предложил свою цену',
  approved: 'автор согласился',
  rejected: 'автор отказал',
}

export interface PinRequest {
  uri: string
  title: string
  /** handle автора поста — он решает */
  author: string
  /** предложение автору, ₽ — разово, от MIN_PIN_OFFER */
  offer: number
  /** встречная цена автора, ₽ — при approval = countered */
  counter?: number
  approval: PinApproval
  decidedAt?: string
}

/** автор называет свою цену: рекламодатель примет её или изменит своё предложение */
export function counterPin(list: AdCreative[], id: string, price: number, now = new Date()): AdCreative[] {
  return list.map((a) =>
    a.id === id && a.pinnedTo ? { ...a, pinnedTo: { ...a.pinnedTo, counter: price, approval: 'countered', decidedAt: now.toISOString() } } : a,
  )
}

/** рекламодатель принял цену автора — это и есть согласие обеих сторон: креатив «Закреплён» */
export function acceptCounter(a: AdCreative, now = new Date()): AdCreative {
  if (!a.pinnedTo || a.pinnedTo.approval !== 'countered' || !a.pinnedTo.counter) return a
  return { ...a, status: 'pinned', launchedAt: a.launchedAt ?? now.toISOString(), pinnedTo: { ...a.pinnedTo, offer: a.pinnedTo.counter, counter: undefined, approval: 'approved', decidedAt: now.toISOString() } }
}

/** закреплённый креатив показывается только после согласия автора */
export const pinLive = (a: AdCreative) => !!a.pinnedTo && a.pinnedTo.approval === 'approved'

/** базовая ставка демо-кабинета, ₽ за 1000 показов */
export const BASE_CPM = 300
/** скрыть креатив с публичной доски — +25% к ставке */
export const HIDE_FROM_BOARD_MARKUP = 0.25
/**
 * Закрепить за постом — цену предлагает рекламодатель, от MIN_PIN_OFFER и без потолка: у известного автора
 * место стоит дороже, а решает всё равно автор — согласен на сумму или нет. Закрепление пишется в запись поста
 * в PDS автора: она публична, копии уходят ретрансляторам и индексам сети, полностью отозвать нельзя —
 * это бессрочное размещение, отсюда высокий минимум.
 */
export const MIN_PIN_OFFER = 50_000

/** Креатив может попасть в РФ: RU в любом из списков или гео не задано (показ везде) — нужна маркировка */
export function needsErid(geo: AdGeo): boolean {
  const any = geo.residence.length > 0 || geo.registration.length > 0
  return !any || geo.residence.includes('RU') || geo.registration.includes('RU')
}

/** читатель подходит под гео: страна резидентства и регистрации (у гостя — только страна по IP) */
/** читатель подходит под аудиторию: вошёл ли он в аккаунт */
export function matchesAudience(a: Pick<AdCreative, 'audience'>, signedIn: boolean): boolean {
  return a.audience === 'all' || (a.audience === 'registered') === signedIn
}

export function matchesGeo(geo: AdGeo, viewer: { residence?: string; registration?: string }): boolean {
  const ok = (list: string[], c?: string) => list.length === 0 || (!!c && list.includes(c))
  return ok(geo.residence, viewer.residence) && ok(geo.registration, viewer.registration)
}

/** цена в демо-кабинете: ставка с доплатами — для ориентира рекламодателю */
export function adPrice(ad: Pick<AdCreative, 'hiddenFromBoard' | 'pinnedTo'>): { cpm: number; pin: number | null } {
  return {
    cpm: Math.round(BASE_CPM * (1 + (ad.hiddenFromBoard ? HIDE_FROM_BOARD_MARKUP : 0))),
    // без согласия автора не списываем
    pin: ad.pinnedTo && ad.pinnedTo.approval !== 'rejected' ? ad.pinnedTo.offer : null,
  }
}

export interface AdSchedule {
  /** ISO; у «Запланирован» — когда начать */
  startsAt?: string
  /** ISO; после — не показываем */
  endsAt?: string
  /** часы показа по местному времени читателя, [from, to) — 9..18 = с 09:00 до 18:00; from > to — через полночь */
  hours?: { from: number; to: number }
}

/** в расписании ли сейчас: дата старта и конца, часы суток */
export function inSchedule(s: AdSchedule | undefined, now = new Date()): boolean {
  if (!s) return true
  if (s.startsAt && Date.parse(s.startsAt) > now.getTime()) return false
  if (s.endsAt && Date.parse(s.endsAt) <= now.getTime()) return false
  if (s.hours) {
    const h = now.getHours()
    const { from, to } = s.hours
    if (from !== to && !(from < to ? h >= from && h < to : h >= from || h < to)) return false
  }
  return true
}

/** показывается ли сейчас: статус «в эфире» (или подошёл старт запланированного) и расписание */
export const isLive = (a: AdCreative, now = new Date()) =>
  (a.status === 'running' || a.status === 'prolonged' || a.status === 'pinned' || (a.status === 'scheduled' && !!a.schedule?.startsAt)) &&
  inSchedule(a.schedule, now)

/** уже показывался: тогда содержимое закрыто для правок */
export const launched = (a: AdCreative, now = new Date()) =>
  !!a.launchedAt || (a.status === 'scheduled' && !!a.schedule?.startsAt && Date.parse(a.schedule.startsAt) <= now.getTime())

/** порядок статусов в фильтрах */
export const AD_STATUSES: AdStatus[] = ['draft', 'scheduled', 'running', 'paused', 'prolonged', 'pinned', 'finished']

/**
 * Решение автора поста. Согласие — креатив «Закреплён» и показывается в посте; отказ — закрепление снимается,
 * креатив возвращается к обычным показам по гео.
 */
export function decidePin(list: AdCreative[], id: string, approve: boolean, now = new Date()): AdCreative[] {
  return list.map((a) =>
    a.id === id && a.pinnedTo
      ? {
          ...a,
          status: approve ? 'pinned' : a.status === 'pinned' ? 'running' : a.status,
          ...(approve && !a.launchedAt ? { launchedAt: now.toISOString() } : {}),
          pinnedTo: { ...a.pinnedTo, approval: approve ? 'approved' : 'rejected', decidedAt: now.toISOString() },
        }
      : a,
  )
}

/** старый формат (active: boolean, erid обязателен) → новый */
function normalize(a: AdCreative & { active?: boolean }): AdCreative {
  return {
    ...a,
    status: a.status ?? (a.active === false ? 'paused' : 'running'),
    geo: a.geo ?? { residence: [], registration: [] },
    hiddenFromBoard: a.hiddenFromBoard ?? false,
    audience: a.audience ?? 'all',
    createdAt: a.createdAt ?? new Date(0).toISOString(),
    // закрепления до введения согласия — без автора: считаем, что согласия ещё нет
    ...(a.pinnedTo
      ? { pinnedTo: { ...a.pinnedTo, author: a.pinnedTo.author ?? '', offer: a.pinnedTo.offer ?? MIN_PIN_OFFER, approval: a.pinnedTo.approval ?? 'pending' } }
      : {}),
  }
}

export const AD_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const
export const AD_IMAGE_MAX_BYTES = 1024 * 1024

const KEY = 'weat-ads'

/** демо-креативов в проде нет: баннеры — только созданные рекламодателями */
export const DEFAULT_ADS: AdCreative[] = []

export function loadAds(): AdCreative[] {
  try {
    const raw = localStorage.getItem(KEY)
    const list = raw ? (JSON.parse(raw) as AdCreative[]) : null
    // старые демо-креативы из браузера (ad1, ad2…) — не показываем
    return Array.isArray(list) ? list.map(normalize).filter((a) => !/^ad\d+$/.test(a.id)) : DEFAULT_ADS
  } catch {
    return DEFAULT_ADS
  }
}

export function saveAds(list: AdCreative[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list))
  } catch {
    /* квота localStorage: data:-картинки большие — креатив останется до перезагрузки */
  }
}

/** картинка только https или загруженный файл разрешённого типа; иначе не показываем */
export function safeAdImageSrc(src: string): string | null {
  if (/^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(src)) return src
  try {
    return new URL(src).protocol === 'https:' ? src : null
  } catch {
    return null
  }
}

export function readImageFile(file: File): Promise<AdImage> {
  return new Promise((resolve, reject) => {
    if (!(AD_IMAGE_TYPES as readonly string[]).includes(file.type)) return reject(new Error('Нужен PNG, JPEG, WebP или GIF'))
    if (file.size > AD_IMAGE_MAX_BYTES) return reject(new Error('Файл больше 1 МБ'))
    const r = new FileReader()
    r.onload = () => resolve({ src: String(r.result), alt: '', animated: file.type === 'image/gif' })
    r.onerror = () => reject(new Error('Не удалось прочитать файл'))
    r.readAsDataURL(file)
  })
}
