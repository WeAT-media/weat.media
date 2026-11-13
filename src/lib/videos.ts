import type { Article, VideoItem } from '@/types/types'

/**
 * Обратносовместимая нормализация видео статьи в плейлист:
 * videos[] используется как есть; иначе legacy-поля одиночного видео
 * (videoUrl/videoDescription/videoPreviewRange) собираются в один VideoItem.
 */
export function normalizeVideos(article: Article, sessionSrc?: string): VideoItem[] {
  if (article.videos && article.videos.length > 0) return article.videos
  if (article.kind !== 'video') return []
  const src = sessionSrc ?? article.videoUrl
  return [
    {
      id: `${article.id}-video-1`,
      title: article.title,
      description: article.videoDescription,
      source: 'native',
      src,
      analyticsCapabilities: { retention: true, ctr: true },
    },
  ]
}
