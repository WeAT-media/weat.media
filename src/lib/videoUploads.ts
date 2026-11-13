/** Локальные видео-загрузки прототипа: object URL живёт только в текущей сессии вкладки */

const sessionVideos = new Map<string, string>()
const keptUrls = new Set<string>()

/** Предельный размер локального видеофайла (500 МБ) */
export const MAX_VIDEO_SIZE = 500 * 1024 * 1024

/** Передать object URL опубликованной статье: URL не будет отозван при размонтировании редактора */
export function keepSessionVideo(articleId: string, url: string): void {
  sessionVideos.set(articleId, url)
  keptUrls.add(url)
}

/** object URL текущей сессии для статьи, загруженной файлом; после перезагрузки вкладки его нет */
export function getSessionVideo(articleId: string): string | undefined {
  return sessionVideos.get(articleId)
}

/** Отозвать object URL, если он не передан опубликованной статье */
export function releaseObjectUrl(url: string): void {
  if (!keptUrls.has(url)) URL.revokeObjectURL(url)
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} КБ`
  return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`
}
