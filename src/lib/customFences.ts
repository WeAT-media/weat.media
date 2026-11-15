import { normalizeIVideo } from '@/lib/interactiveVideo'
import { parseFaq } from '@/lib/faq'
import { parseActionButton } from '@/lib/actionButton'
import { normalizePoll } from '@/lib/poll'
import type { ArticleBlock } from '@/types/types'

/**
 * Свои блоки редактора в markdown — code-фенсы с JSON внутри (```button, ```faq…, см. customBlocks.ts).
 * Один разбор для предпросмотра в редакторе и для статей из индекса: иначе опубликованная кнопка
 * читателю показалась бы блоком кода. Всё нормализуется — читатель получает только проверенное.
 */

const FENCES = ['carousel', 'poll', 'userblock', 'button', 'faq', 'ivideo', 'callout', 'bookmark'] as const

export const isCustomFence = (lang: string) => (FENCES as readonly string[]).includes(lang)

/** null — битый или пустой блок: пропускаем, а не показываем сырой JSON */
export function customFenceBlock(lang: string, inner: string): ArticleBlock | null {
  try {
    switch (lang) {
      case 'carousel': {
        // плоский формат, который понимает ArticleCarousel: «адрес | подпись» построчно
        const { items } = JSON.parse(inner) as { items: { url: string; caption?: string }[] }
        return { type: 'carousel', text: items.map((s) => `${s.url}${s.caption ? ` | ${s.caption}` : ''}`).join('\n') }
      }
      case 'poll':
        // JSON целиком: вопрос, варианты и настройки (src/lib/poll.ts)
        return { type: 'poll', text: JSON.stringify(normalizePoll(JSON.parse(inner))) }
      case 'userblock':
        // свой блок автора: снимок шаблона и значения полей
        return { type: 'userblock', text: inner }
      case 'button': {
        // кнопка с действием: проверенная ссылка (https или путь на сайте)
        const btn = parseActionButton(inner)
        return btn ? { type: 'button', text: JSON.stringify(btn) } : null
      }
      case 'faq': {
        const faq = parseFaq(inner)
        return faq ? { type: 'faq', text: JSON.stringify(faq) } : null
      }
      case 'ivideo': {
        const { data } = normalizeIVideo(JSON.parse(inner))
        return data.segments.length ? { type: 'ivideo', text: JSON.stringify(data) } : null
      }
      case 'callout':
        // безопасный рендер — CalloutView (без arbitrary HTML)
        return { type: 'callout', text: inner }
      case 'bookmark': {
        // карточка ссылки редактора («/link»): адрес обязателен, остальное — превью
        const b = JSON.parse(inner) as { url?: unknown }
        return typeof b.url === 'string' && /^https?:\/\//.test(b.url) ? { type: 'bookmark', text: inner } : null
      }
    }
  } catch {
    /* битый JSON — пропускаем блок */
  }
  return null
}
