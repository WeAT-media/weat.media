/**
 * Одноразовая инициализация BlockSuite: effects() регистрируют custom elements
 * без guards, поэтому защищаем CustomElementRegistry.define от повторных имён
 * (несколько редакторов на странице, HMR в dev). Флаг на window переживает
 * перезагрузку модулей при HMR. Ошибки не глушатся: пропускается только
 * повторная регистрация уже существующего имени.
 */
declare global {
  interface Window {
    __blocksuiteCeGuard?: boolean
    __blocksuiteEffectsReady?: Promise<void>
  }
}

export async function setupBlocksuite(): Promise<void> {
  if (typeof window === 'undefined') return

  if (!window.__blocksuiteCeGuard) {
    window.__blocksuiteCeGuard = true
    const orig = CustomElementRegistry.prototype.define
    CustomElementRegistry.prototype.define = function (name, constructor, options) {
      if (this.get(name)) return
      orig.call(this, name, constructor, options)
    }
  }

  // Promise, не boolean: конкурентные вызовы (второй редактор на странице,
  // React StrictMode double-mount) должны реально дождаться завершения
  // effects(), а не увидеть "уже начато" и продолжить до регистрации элементов.
  if (!window.__blocksuiteEffectsReady) {
    window.__blocksuiteEffectsReady = (async () => {
      // CSS-переменные темы AFFiNE — без них slash-menu и поповеры прозрачные
      await import('@toeverything/theme/style.css')
      const [{ effects: blocksEffects }, { effects: presetsEffects }] = await Promise.all([
        import('@blocksuite/blocks/effects'),
        import('@blocksuite/presets/effects'),
      ])
      blocksEffects()
      presetsEffects()
    })()
  }
  await window.__blocksuiteEffectsReady
}
