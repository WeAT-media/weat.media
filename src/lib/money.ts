/** Валюты площадки и форматирование цен */

export type Currency = 'RUB' | 'USD' | 'EUR'

export const CURRENCIES: { code: Currency; label: string }[] = [
  { code: 'RUB', label: 'Рубль, ₽' },
  { code: 'USD', label: 'Доллар США, $' },
  { code: 'EUR', label: 'Евро, €' },
]

const RUB_COUNTRIES = new Set(['RU', 'BY', 'KZ', 'KG', 'TJ', 'UZ', 'AM', 'AZ', 'MD', 'TM'])
const EUR_COUNTRIES = new Set([
  'AT', 'BE', 'HR', 'CY', 'EE', 'FI', 'FR', 'DE', 'GR', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PT', 'SK', 'SI', 'ES',
  'ME', 'XK', 'AD', 'MC', 'SM', 'VA',
])

/** Валюта по умолчанию для страны; явный выбор в настройках важнее */
export function currencyForCountry(country: string | undefined): Currency {
  if (!country) return 'RUB'
  if (RUB_COUNTRIES.has(country)) return 'RUB'
  if (EUR_COUNTRIES.has(country)) return 'EUR'
  return 'USD'
}

/** amount — в основных единицах (рубли, доллары); у кошелька/копеек — делить заранее */
export function formatMoney(amount: number, currency: Currency = 'RUB', locale = 'ru-RU'): string {
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      maximumFractionDigits: Number.isInteger(amount) ? 0 : 2,
    }).format(amount)
  } catch {
    return `${amount} ${currency}`
  }
}
