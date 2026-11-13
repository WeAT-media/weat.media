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

export interface AdCreative {
  id: string
  erid: string
  /** рекламодатель: название или ИНН — обязательная часть маркировки */
  advertiser: string
  title: string
  text: string
  url: string
  cta: string
  image?: AdImage
  active: boolean
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
  active: true,
}

export function loadAds(): AdCreative[] {
  try {
    const raw = localStorage.getItem(KEY)
    const list = raw ? (JSON.parse(raw) as AdCreative[]) : null
    return Array.isArray(list) && list.length ? list : [DEFAULT_AD]
  } catch {
    return [DEFAULT_AD]
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
