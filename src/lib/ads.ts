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

/** история креатива: идёт, на паузе, продлена (новый срок после окончания), завершена */
export type AdStatus = 'running' | 'paused' | 'prolonged' | 'finished'

export const AD_STATUS_LABEL: Record<AdStatus, string> = {
  running: 'Идёт',
  paused: 'Пауза',
  prolonged: 'Продлена',
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

export interface AdCreative {
  id: string
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
  /** закреплён за постом: показывается только в нём (PIN_MULTIPLIER × базовой ставки) */
  pinnedTo?: { uri: string; title: string }
  createdAt: string
}

/** базовая ставка демо-кабинета, ₽ за 1000 показов */
export const BASE_CPM = 300
/** скрыть креатив с публичной доски — +25% к ставке */
export const HIDE_FROM_BOARD_MARKUP = 0.25
/**
 * Закрепить за постом — ×200. Закрепление пишется в запись поста в репозитории автора (PDS): запись публична,
 * её копии уходят ретрансляторам и индексам сети, полностью отозвать её нельзя. Это бессрочное размещение,
 * а не показ на время, — отсюда цена.
 */
export const PIN_MULTIPLIER = 200

/** Креатив может попасть в РФ: RU в любом из списков или гео не задано (показ везде) — нужна маркировка */
export function needsErid(geo: AdGeo): boolean {
  const any = geo.residence.length > 0 || geo.registration.length > 0
  return !any || geo.residence.includes('RU') || geo.registration.includes('RU')
}

/** читатель подходит под гео: страна резидентства и регистрации (у гостя — только страна по IP) */
export function matchesGeo(geo: AdGeo, viewer: { residence?: string; registration?: string }): boolean {
  const ok = (list: string[], c?: string) => list.length === 0 || (!!c && list.includes(c))
  return ok(geo.residence, viewer.residence) && ok(geo.registration, viewer.registration)
}

/** цена в демо-кабинете: ставка с доплатами — для ориентира рекламодателю */
export function adPrice(ad: Pick<AdCreative, 'hiddenFromBoard' | 'pinnedTo'>): { cpm: number; pin: number | null } {
  return {
    cpm: Math.round(BASE_CPM * (1 + (ad.hiddenFromBoard ? HIDE_FROM_BOARD_MARKUP : 0))),
    pin: ad.pinnedTo ? BASE_CPM * PIN_MULTIPLIER : null,
  }
}

export const isLive = (a: AdCreative) => a.status === 'running' || a.status === 'prolonged'

/** старый формат (active: boolean, erid обязателен) → новый */
function normalize(a: AdCreative & { active?: boolean }): AdCreative {
  return {
    ...a,
    status: a.status ?? (a.active === false ? 'paused' : 'running'),
    geo: a.geo ?? { residence: [], registration: [] },
    hiddenFromBoard: a.hiddenFromBoard ?? false,
    createdAt: a.createdAt ?? new Date(0).toISOString(),
  }
}

export const AD_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const
export const AD_IMAGE_MAX_BYTES = 1024 * 1024

const KEY = 'weat-ads'

export const DEFAULT_AD: AdCreative = {
  id: 'ad1',
  erid: '2VtzqW7EKb6',
  advertiser: 'ООО «Пример»',
  title: 'Горячие клавиши для вашего терминала не настроены?',
  text: 'Карманный трекер задач для инженеров — офлайн, без подписок, экспорт в markdown.',
  url: 'https://example.com/ad',
  cta: 'Перейти',
  status: 'running',
  geo: { residence: [], registration: [] },
  hiddenFromBoard: false,
  createdAt: '2026-11-01T00:00:00.000Z',
}

/** демо-набор: разные статусы и гео — чтобы история и доска не были пустыми */
export const DEFAULT_ADS: AdCreative[] = [
  DEFAULT_AD,
  {
    id: 'ad2',
    advertiser: 'TOO «Демо», БИН 000000000000',
    title: 'Облачный CI для студий Алматы и Тбилиси',
    text: 'Сборки за минуты, оплата в тенге и лари.',
    url: 'https://example.com/ci',
    cta: 'Попробовать',
    status: 'paused',
    geo: { residence: ['KZ', 'GE'], registration: [] },
    hiddenFromBoard: false,
    createdAt: '2026-11-05T00:00:00.000Z',
  },
  {
    id: 'ad3',
    erid: '2VtzxP4MNd2',
    advertiser: 'ООО «Курсы»',
    title: 'Курс по миграции на AT Protocol',
    text: 'Шесть недель, практика на своём PDS.',
    url: 'https://example.com/course',
    cta: 'Записаться',
    status: 'finished',
    geo: { residence: ['RU'], registration: ['RU'] },
    hiddenFromBoard: false,
    createdAt: '2026-10-01T00:00:00.000Z',
  },
]

export function loadAds(): AdCreative[] {
  try {
    const raw = localStorage.getItem(KEY)
    const list = raw ? (JSON.parse(raw) as AdCreative[]) : null
    return Array.isArray(list) && list.length ? list.map(normalize) : DEFAULT_ADS
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
