/**
 * Интерактивное видео (Developer preview): фрагменты с ветвлением, главы, метки на кадре, вопросы по ходу.
 * Хранится JSON-строкой в блоке (```ivideo в markdown), как опрос и карусель.
 * Фрагменты — прямые ссылки на видеофайлы (mp4/webm): у встраиваний YouTube и др. нет точного
 * управления временем и бесшовного переключения.
 */

export interface IVSegment {
  id: string
  title: string
  /** https://…mp4 | webm */
  src: string
}

export interface IVChapter {
  segment: string
  /** секунда начала */
  t: number
  title: string
}

export type IVAction = { type: 'link'; url: string } | { type: 'seek'; t: number } | { type: 'segment'; id: string }

export interface IVHotspot {
  segment: string
  from: number
  to: number
  /** позиция в процентах кадра */
  x: number
  y: number
  label: string
  action: IVAction
}

export interface IVOption {
  label: string
  /** для викторины: правильный ответ */
  correct?: boolean
  /** ветвление: после ответа играть другой фрагмент */
  goto?: string
}

export interface IVQuestion {
  id: string
  segment: string
  t: number
  prompt: string
  options: IVOption[]
}

export interface InteractiveVideo {
  v: 1
  start: string
  segments: IVSegment[]
  chapters: IVChapter[]
  hotspots: IVHotspot[]
  questions: IVQuestion[]
}

export const DEFAULT_IVIDEO: InteractiveVideo = {
  v: 1,
  start: 'intro',
  segments: [
    { id: 'intro', title: 'Вступление', src: 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4' },
    { id: 'deep', title: 'Подробнее', src: 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.webm' },
  ],
  chapters: [
    { segment: 'intro', t: 0, title: 'Начало' },
    { segment: 'intro', t: 3, title: 'Цветок' },
  ],
  hotspots: [{ segment: 'intro', from: 1, to: 4, x: 70, y: 20, label: 'Что это за цветок?', action: { type: 'link', url: 'https://ru.wikipedia.org/wiki/Цветок' } }],
  questions: [
    {
      id: 'q1',
      segment: 'intro',
      t: 4,
      prompt: 'Смотреть подробнее?',
      options: [
        { label: 'Да, подробнее', goto: 'deep' },
        { label: 'Нет, дальше', correct: true },
      ],
    },
  ],
}

const num = (v: unknown, min: number, max: number, def: number) => {
  const n = Number(v)
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def
}
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
const id = (v: unknown) => str(v, 32).replace(/[^\w-]/g, '')

/** только https-видео: на https-странице http-видео заблокирует браузер */
export function safeVideoSrc(raw: string): string | null {
  try {
    const u = new URL(raw)
    return u.protocol === 'https:' ? u.toString() : null
  } catch {
    return null
  }
}

/** Приводит чужой JSON к безопасной форме; ошибки — для редактора */
export function normalizeIVideo(raw: unknown): { data: InteractiveVideo; errors: string[] } {
  const errors: string[] = []
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const segments: IVSegment[] = (Array.isArray(r.segments) ? r.segments : []).slice(0, 20).flatMap((s: Record<string, unknown>) => {
    const sid = id(s?.id)
    const src = safeVideoSrc(str(s?.src, 2000))
    if (!sid) return errors.push('у фрагмента нет id'), []
    if (!src) return errors.push(`фрагмент «${sid}»: нужен адрес https://…mp4 или webm`), []
    return [{ id: sid, title: str(s?.title, 80) || sid, src }]
  })
  const ids = new Set(segments.map((s) => s.id))
  if (segments.length === 0) errors.push('нужен хотя бы один фрагмент')
  const seg = (v: unknown) => (ids.has(id(v)) ? id(v) : null)

  const chapters: IVChapter[] = (Array.isArray(r.chapters) ? r.chapters : []).slice(0, 50).flatMap((c: Record<string, unknown>) => {
    const s = seg(c?.segment)
    return s && str(c?.title, 80) ? [{ segment: s, t: num(c?.t, 0, 36_000, 0), title: str(c?.title, 80) }] : []
  })

  const action = (a: Record<string, unknown> | undefined): IVAction | null => {
    if (a?.type === 'link') {
      const url = str(a.url, 2000)
      try {
        return new URL(url).protocol === 'https:' ? { type: 'link', url } : null
      } catch {
        return null
      }
    }
    if (a?.type === 'seek') return { type: 'seek', t: num(a.t, 0, 36_000, 0) }
    if (a?.type === 'segment' && seg(a.id)) return { type: 'segment', id: seg(a.id)! }
    return null
  }
  const hotspots: IVHotspot[] = (Array.isArray(r.hotspots) ? r.hotspots : []).slice(0, 50).flatMap((h: Record<string, unknown>) => {
    const s = seg(h?.segment)
    const a = action(h?.action as Record<string, unknown>)
    if (!s || !a || !str(h?.label, 60)) return errors.push('метка: нужны segment, label и action (https-ссылка, seek или segment)'), []
    const from = num(h?.from, 0, 36_000, 0)
    return [{ segment: s, from, to: Math.max(from + 0.5, num(h?.to, 0, 36_000, from + 3)), x: num(h?.x, 0, 100, 50), y: num(h?.y, 0, 100, 50), label: str(h?.label, 60), action: a }]
  })

  const questions: IVQuestion[] = (Array.isArray(r.questions) ? r.questions : []).slice(0, 30).flatMap((q: Record<string, unknown>, i: number) => {
    const s = seg(q?.segment)
    const options = (Array.isArray(q?.options) ? q.options : []).slice(0, 6).flatMap((o: Record<string, unknown>) =>
      str(o?.label, 80) ? [{ label: str(o.label, 80), ...(o.correct === true ? { correct: true } : {}), ...(seg(o.goto) ? { goto: seg(o.goto)! } : {}) }] : [],
    )
    if (!s || !str(q?.prompt, 200) || options.length < 2) return errors.push('вопрос: нужны segment, prompt и минимум два варианта'), []
    return [{ id: id(q?.id) || `q${i + 1}`, segment: s, t: num(q?.t, 0, 36_000, 0), prompt: str(q.prompt, 200), options }]
  })

  const start = seg(r.start) ?? segments[0]?.id ?? ''
  return { data: { v: 1, start, segments, chapters, hotspots, questions }, errors }
}

export function parseIVideo(text: string): InteractiveVideo | null {
  try {
    const { data } = normalizeIVideo(JSON.parse(text))
    return data.segments.length ? data : null
  } catch {
    return null
  }
}
