/** Каталог языков публикаций: код ISO 639-1 + русское название */
export const LANGUAGES = [
  { code: 'ru', name: 'Русский' },
  { code: 'en', name: 'Английский' },
  { code: 'uk', name: 'Украинский' },
  { code: 'be', name: 'Белорусский' },
  { code: 'de', name: 'Немецкий' },
  { code: 'fr', name: 'Французский' },
  { code: 'es', name: 'Испанский' },
  { code: 'it', name: 'Итальянский' },
  { code: 'pt', name: 'Португальский' },
  { code: 'pl', name: 'Польский' },
  { code: 'cs', name: 'Чешский' },
  { code: 'nl', name: 'Нидерландский' },
  { code: 'sv', name: 'Шведский' },
  { code: 'tr', name: 'Турецкий' },
  { code: 'ar', name: 'Арабский' },
  { code: 'hi', name: 'Хинди' },
  { code: 'zh', name: 'Китайский' },
  { code: 'ja', name: 'Японский' },
  { code: 'ko', name: 'Корейский' },
] as const

export type LanguageCode = (typeof LANGUAGES)[number]['code']

/** Название языка для UI; неизвестный/старый код показываем как есть */
export function languageName(code?: string): string {
  const found = LANGUAGES.find((l) => l.code === code)
  return found ? found.name : (code ?? 'ru').toUpperCase()
}
