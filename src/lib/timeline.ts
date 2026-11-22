export type TimelineOrientation = 'vertical' | 'horizontal'

export interface TimelineItem {
  date: string
  title: string
  text: string
}

export interface Timeline {
  title: string
  orientation: TimelineOrientation
  items: TimelineItem[]
}

export const DEFAULT_TIMELINE: Timeline = {
  title: 'Хронология',
  orientation: 'vertical',
  items: [
    { date: '2026', title: 'Первое событие', text: 'Что произошло и почему это важно.' },
    { date: '2027', title: 'Следующий этап', text: 'Добавьте детали события.' },
  ],
}

export function parseTimeline(raw: string): Timeline | null {
  try {
    const data = JSON.parse(raw) as Partial<Timeline>
    const items = (Array.isArray(data.items) ? data.items : [])
      .filter((item) => typeof item?.date === 'string' && typeof item?.title === 'string' && typeof item?.text === 'string')
      .slice(0, 50)
      .map((item) => ({
        date: item.date.trim().slice(0, 120),
        title: item.title.trim().slice(0, 200),
        text: item.text.trim().slice(0, 2000),
      }))
      .filter((item) => item.date || item.title || item.text)
    if (!items.length) return null
    return {
      title: typeof data.title === 'string' ? data.title.trim().slice(0, 120) : '',
      orientation: data.orientation === 'horizontal' ? 'horizontal' : 'vertical',
      items,
    }
  } catch {
    return null
  }
}
