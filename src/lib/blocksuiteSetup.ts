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
    __blocksuiteFocusGuard?: boolean
    __blocksuiteLinkPreview?: boolean
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

  // Поповеры BlockSuite (ссылка «Turn into link»/«/link», подпись и правка карточки, псевдоним ссылки на
  // документ) вставляются в <body> и ставят фокус в поле раньше, чем встанут на место: браузер прокручивает
  // страницу к полю — «улетает скролл». Фокус внутри них — без прокрутки; позицию они выставляют сами.
  if (!window.__blocksuiteFocusGuard) {
    window.__blocksuiteFocusGuard = true
    const POPUPS = 'link-popup, reference-alias-popup, embed-card-create-modal, embed-card-edit-modal, embed-card-caption-edit-modal, affine-custom-modal'
    const inPopup = (el: Element): boolean => {
      for (let n: Node | null = el; n; ) {
        if (n instanceof Element && n.matches(POPUPS)) return true
        n = n.parentNode ?? (n instanceof ShadowRoot ? n.host : null)
      }
      return false
    }
    const focus = HTMLElement.prototype.focus
    HTMLElement.prototype.focus = function (this: HTMLElement, options?: FocusOptions) {
      return focus.call(this, inPopup(this) ? { ...options, preventScroll: true } : options)
    }
  }

  // Превью ссылок («/link», вставка URL): BlockSuite шлёт POST на сервис AFFiNE — он нам недоступен
  // («Failed to retrieve link information»). Подмена сервиса в классе не помогает: в сборке несколько копий
  // BlockSuite. Перехватываем сам запрос и отвечаем превью от своего AppView в формате сервиса AFFiNE.
  if (!window.__blocksuiteLinkPreview) {
    window.__blocksuiteLinkPreview = true
    const AFFINE = 'https://affine-worker.toeverything.workers.dev/api/worker/link-preview'
    const origFetch = window.fetch.bind(window)
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (url !== AFFINE) return origFetch(input, init)
      const { linkPreview } = await import('@/lib/api')
      const target = (JSON.parse(String(init?.body ?? '{}')) as { url?: string }).url ?? ''
      const p = await linkPreview(target, init?.signal ?? undefined).catch(() => null)
      if (!p) return new Response(JSON.stringify({ error: 'NotFound' }), { status: 404, headers: { 'content-type': 'application/json' } })
      const body = { url: p.url, title: p.title ?? '', description: p.description ?? '', favicons: p.icon ? [p.icon] : [], images: p.image ? [p.image] : [] }
      return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
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
