import type { CalloutTone } from '@/types/types'
import type { BlockDef } from '@/lib/userBlocks'

/**
 * Процессные capabilities визуального редактора: премиум-гейт кастомных
 * блоков и дефолты новых callout'ов. Живёт в отдельном лёгком модуле, чтобы
 * customBlocks.ts (тянет весь BlockSuite) не попадал в основной чанк через store.
 * StoreProvider вызывает setEditorCaps при изменении user/editorPrefs.
 */
export interface EditorCaps {
  premium: boolean
  customBlocksEnabled: boolean
  callout: { tone: CalloutTone; icon: string }
  /** пользовательские блоки автора (Premium) — пункты «/»-меню */
  blockDefs: BlockDef[]
  /** экспериментальные блоки (Настройки → Разработчикам → Developer preview) */
  devPreview: boolean
}

let caps: EditorCaps = {
  premium: false,
  customBlocksEnabled: true,
  callout: { tone: 'info', icon: '💡' },
  blockDefs: [],
  devPreview: false,
}

export function setEditorCaps(next: EditorCaps) {
  caps = next
}

export function getEditorCaps(): EditorCaps {
  return caps
}
