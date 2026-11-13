/** FAQ-блок статьи: JSON { title, items: [{ q, a }] } */

export interface Faq {
  title: string
  items: { q: string; a: string }[]
}

export function parseFaq(raw: string): Faq | null {
  try {
    const d = JSON.parse(raw) as Partial<Faq>
    const items = (Array.isArray(d.items) ? d.items : [])
      .filter((it) => typeof it?.q === 'string' && typeof it?.a === 'string' && it.q.trim() && it.a.trim())
      .slice(0, 30)
      .map((it) => ({ q: it.q.trim().slice(0, 300), a: it.a.trim().slice(0, 4000) }))
    return items.length ? { title: typeof d.title === 'string' ? d.title.slice(0, 120) : '', items } : null
  } catch {
    return null
  }
}
