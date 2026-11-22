import { api } from '@/lib/api'

/**
 * Согласие на статистику для посетителей из ЕЭЗ, Великобритании и Швейцарии (GDPR, ePrivacy, UK GDPR, FADP).
 * Аналитика не пишет идентификаторы на устройство, но считает посетителей по дневному хешу IP и User-Agent и получает
 * псевдонимную canvas-сигнатуру — это обработка персональных данных; UTM-метки сохраняются ради атрибуции.
 * Поэтому там до выбора ни то, ни другое не работает. Остальным — как раньше (DNT и GPC по-прежнему отключают).
 */

export type Consent = 'necessary' | 'analytics'

const KEY = 'indie-media:consent'
const REGION_KEY = 'indie-media:region-eu'
/** ЕС-27, ЕЭЗ (Исландия, Лихтенштейн, Норвегия), Великобритания, Швейцария */
const EU = new Set(
  'AT BE BG HR CY CZ DK EE FI FR DE GR HU IE IT LV LT LU MT NL PL PT RO SK SI ES SE IS LI NO GB CH'.split(' '),
)

export const CONSENT_EVENT = 'indie-media:consent'

export function getConsent(): Consent | null {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'necessary' || v === 'analytics' ? v : null
  } catch {
    return null
  }
}

export function setConsent(c: Consent) {
  try {
    localStorage.setItem(KEY, c)
  } catch {
    /* без хранилища выбор живёт до перезагрузки */
  }
  window.dispatchEvent(new CustomEvent(CONSENT_EVENT, { detail: c }))
}

/** «Настройки cookie» из футера — показать баннер снова */
export const reopenConsent = () => window.dispatchEvent(new CustomEvent(CONSENT_EVENT, { detail: 'reopen' }))

let region: Promise<boolean> | null = null
/** посетитель из ЕЭЗ/UK/CH — по стране IP; ответ кэшируется на вкладку. Не узнали — считаем, что да */
export function isEuVisitor(): Promise<boolean> {
  try {
    const cached = sessionStorage.getItem(REGION_KEY)
    if (cached) return Promise.resolve(cached === '1')
  } catch {
    /* noop */
  }
  region ??= api.geo().then(
    (g) => {
      const eu = EU.has(g.country)
      try {
        sessionStorage.setItem(REGION_KEY, eu ? '1' : '0')
      } catch {
        /* noop */
      }
      return eu
    },
    () => true,
  )
  return region
}

/** можно ли считать статистику и хранить UTM: выбор посетителя, а без выбора — только вне ЕЭЗ/UK/CH */
export async function analyticsAllowed(): Promise<boolean> {
  const c = getConsent()
  if (c) return c === 'analytics'
  return !(await isEuVisitor())
}
