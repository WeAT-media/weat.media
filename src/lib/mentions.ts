import { getEditorPeople, type EditorPerson } from '@/lib/editorPeople'

/**
 * @mention-автодополнение для BlockSuite PageEditor (0.19.5), DOM + inline editor API.
 * Ввод «@query» в любом rich-text редактора (кроме doc-title) открывает попап со
 * списком людей; выбор вставляет inline @handle со ссылкой /profile/<handle>
 * (атрибут link — markdown roundtrip через стандартный адаптер сохраняет ссылку).
 * Триггер только после пробела/начала строки — email не затрагивается.
 */

interface InlineRangeLike {
  index: number
  length: number
}

interface InlineEditorLike {
  yTextString: string
  getInlineRange: () => InlineRangeLike | null
  deleteText: (range: InlineRangeLike) => void
  insertText: (range: InlineRangeLike, text: string, attributes?: Record<string, unknown>) => void
  setInlineRange: (range: InlineRangeLike | null) => void
  getNativeRange: () => Range | null
}

const MENTION_RE = /(?:^|\s)@([\p{L}\p{N}._-]{0,32})$/u
const MAX_ITEMS = 6

export function attachMentions(container: HTMLElement): () => void {
  let popup: HTMLDivElement | null = null
  let state: {
    rt: HTMLElement
    ie: InlineEditorLike
    atIndex: number
    query: string
    items: EditorPerson[]
    active: number
  } | null = null

  const close = () => {
    popup?.remove()
    popup = null
    state = null
  }

  const findRichText = (): { rt: HTMLElement; ie: InlineEditorLike } | null => {
    const sel = document.getSelection()
    if (!sel || !sel.anchorNode) return null
    const node = sel.anchorNode instanceof Element ? sel.anchorNode : sel.anchorNode.parentElement
    const rt = node?.closest?.('rich-text') as HTMLElement | null
    // title редактора не поддерживает mention — он не часть тела статьи
    if (!rt || !container.contains(rt) || rt.closest('doc-title')) return null
    const ie = (rt as unknown as { inlineEditor?: InlineEditorLike }).inlineEditor
    return ie ? { rt, ie } : null
  }

  const apply = (person: EditorPerson) => {
    if (!state) return
    const { ie, atIndex } = state
    const range = ie.getInlineRange()
    if (!range) return close()
    // удаляем «@query» и вставляем mention со ссылкой на профиль
    ie.deleteText({ index: atIndex, length: range.index - atIndex })
    const text = `@${person.handle}`
    ie.insertText({ index: atIndex, length: 0 }, `${text} `, { link: `/profile/${person.handle}` })
    // пробел после mention не должен быть ссылкой
    ie.setInlineRange({ index: atIndex + text.length + 1, length: 0 })
    close()
  }

  const render = () => {
    if (!state) return
    const { items, active, query } = state
    if (!popup) {
      popup = document.createElement('div')
      popup.className = 'mention-popup'
      popup.setAttribute('role', 'listbox')
      popup.setAttribute('aria-label', 'Упомянуть человека')
      container.appendChild(popup)
    }
    popup.textContent = ''
    items.forEach((p, i) => {
      const opt = document.createElement('div')
      opt.className = `mention-popup__item${i === active ? ' is-active' : ''}`
      opt.setAttribute('role', 'option')
      opt.setAttribute('aria-selected', String(i === active))
      const handle = document.createElement('span')
      handle.className = 'mention-popup__handle'
      handle.textContent = `@${p.handle}`
      const name = document.createElement('span')
      name.className = 'mention-popup__name'
      name.textContent = p.name
      opt.append(handle, name)
      // mousedown + preventDefault: selection в редакторе не теряется
      opt.addEventListener('mousedown', (e) => {
        e.preventDefault()
        apply(p)
      })
      popup!.appendChild(opt)
    })
    if (items.length === 0) {
      const empty = document.createElement('div')
      empty.className = 'mention-popup__item is-empty'
      empty.textContent = `@${query} не найден`
      popup.appendChild(empty)
    }
    // выбранный пункт — в видимой части списка (длинный список прокручивается стрелками)
    popup.querySelector<HTMLElement>('.mention-popup__item.is-active')?.scrollIntoView({ block: 'nearest' })
    // позиция под кареткой
    const rect = state.ie.getNativeRange()?.getBoundingClientRect()
    const hostRect = container.getBoundingClientRect()
    if (rect) {
      popup.style.left = `${Math.max(0, rect.left - hostRect.left)}px`
      popup.style.top = `${rect.bottom - hostRect.top + 6}px`
    }
  }

  /** клавиши навигации обрабатывает onKeyDown — их keyup не должен пересобирать список и сбрасывать выбор */
  const NAV_KEYS = new Set(['ArrowDown', 'ArrowUp', 'Enter', 'Tab', 'Escape'])
  const update = (e?: Event) => {
    if (e instanceof KeyboardEvent && NAV_KEYS.has(e.key) && state) return
    const found = findRichText()
    if (!found) return close()
    const { ie } = found
    const range = ie.getInlineRange()
    if (!range || range.length > 0) return close()
    const before = ie.yTextString.slice(0, range.index)
    const m = before.match(MENTION_RE)
    if (!m) return close()
    const query = m[1].toLowerCase()
    const atIndex = range.index - m[1].length - 1
    const q = query
    const pool = getEditorPeople()
    const starts: EditorPerson[] = []
    const contains: EditorPerson[] = []
    for (const p of pool) {
      const h = p.handle.toLowerCase()
      const n = p.name.toLowerCase()
      if (!q) starts.push(p)
      else if (h.startsWith(q) || n.startsWith(q)) starts.push(p)
      else if (h.includes(q) || n.includes(q)) contains.push(p)
    }
    const items = [...starts, ...contains].slice(0, MAX_ITEMS)
    // тот же запрос — выбор сохраняется
    const keep = state && state.query === query && state.atIndex === atIndex ? Math.min(state.active, Math.max(0, items.length - 1)) : 0
    state = { rt: found.rt, ie, atIndex, query, items, active: keep }
    render()
  }

  const onKeyDown = (e: KeyboardEvent) => {
    if (!state || !popup) return
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      e.stopPropagation()
      if (state.items.length === 0) return
      state.active =
        e.key === 'ArrowDown'
          ? (state.active + 1) % state.items.length
          : (state.active - 1 + state.items.length) % state.items.length
      render()
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      const p = state.items[state.active]
      if (p) {
        e.preventDefault()
        e.stopPropagation()
        apply(p)
      }
    } else if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      close()
    }
  }

  const onPointerDown = (e: PointerEvent) => {
    if (popup && !popup.contains(e.target as Node)) close()
  }

  container.addEventListener('keyup', update)
  container.addEventListener('click', update)
  container.addEventListener('keydown', onKeyDown, true)
  document.addEventListener('pointerdown', onPointerDown)

  return () => {
    close()
    container.removeEventListener('keyup', update)
    container.removeEventListener('click', update)
    container.removeEventListener('keydown', onKeyDown, true)
    document.removeEventListener('pointerdown', onPointerDown)
  }
}
