/**
 * Ссылки из чужого контента (статьи, импорт с внешних сайтов, профили приложений).
 * Пропускаем только http(s), mailto и локальные пути; javascript:, data:, vbscript: и //host — нет.
 */
export function safeHref(raw: string | undefined | null): string | undefined {
  if (!raw) return undefined
  const v = raw.trim()
  if (/^\/(?![/\\])/.test(v) || v.startsWith('#')) return v
  try {
    const u = new URL(v)
    return u.protocol === 'https:' || u.protocol === 'http:' || u.protocol === 'mailto:' ? u.toString() : undefined
  } catch {
    return undefined
  }
}

/** возврат после входа/оплаты: только локальный путь, без //host и /\host */
export function safeReturnTo(raw: string | null | undefined, fallback = '/feed'): string {
  return raw && /^\/(?![/\\])[^\s\\]*$/.test(raw) && raw.length <= 300 ? raw : fallback
}

/** картинка из чужого контента: только https (http-картинки браузер всё равно заблокирует на https-сайте) */
export function safeImageSrc(raw: string | undefined | null): string | undefined {
  if (!raw) return undefined
  try {
    const u = new URL(raw.trim())
    return u.protocol === 'https:' ? u.toString() : undefined
  } catch {
    return undefined
  }
}
