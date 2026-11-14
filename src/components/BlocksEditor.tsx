import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, Users } from 'lucide-react'
import type { Doc } from '@blocksuite/store'

interface BlocksEditorProps {
  /** markdown — источник истины снаружи; редактор сериализует изменения обратно */
  value: string
  onChange: (markdown: string) => void
  compact?: boolean
  /** id комнаты BroadcastChannel: совместное редактирование между вкладками этого браузера */
  roomId?: string
  /**
   * Начальный заголовок страницы (blocksuite page-title). Когда задан вместе
   * с onTitleChange, в редакторе монтируется настоящий <doc-title>: заголовок
   * живёт в root-блоке affine:page и сериализуется в markdown как `# Title`.
   */
  title?: string
  onTitleChange?: (title: string) => void
  /**
   * Инспекция содержимого документа на каждом Yjs-обновлении.
   * hasVideo: в теле есть видео-элемент — attachment или embed YouTube/Loom/Video.
   */
  onContentInspect?: (info: { hasVideo: boolean }) => void
}

/** flavours видео-элементов BlockSuite 0.19.5 */
const VIDEO_FLAVOURS = new Set([
  'affine:attachment',
  'affine:embed-youtube',
  'affine:embed-loom',
  'affine:embed-video',
])

/**
 * Настоящий BlockSuite (AFFiNE) PageEditor с markdown-сериализацией
 * через Job + MarkdownAdapter и Yjs-комнатами между вкладками (BroadcastChannel).
 * Инициализация по API 0.19.5: doc создаётся и load() вызывается ДО editor.doc;
 * editor.doc/specs присваиваются ДО appendChild (connectedCallback читает doc).
 */
export default function BlocksEditor({ value, onChange, compact, roomId, title, onTitleChange, onContentInspect }: BlocksEditorProps) {
  const holder = useRef<HTMLDivElement>(null)
  const stateRef = useRef<{ doc: Doc } | null>(null)
  const updateHandlerRef = useRef<(() => void) | null>(null)
  const syncRef = useRef<{ disconnect: () => void } | null>(null)
  const mentionsRef = useRef<(() => void) | null>(null)
  const guardRef = useRef<(() => void) | null>(null)
  const lastSerialized = useRef(value)
  const lastTitle = useRef(title ?? '')
  const onChangeRef = useRef(onChange)
  const onTitleChangeRef = useRef(onTitleChange)
  const onContentInspectRef = useRef(onContentInspect)
  const lastHasVideo = useRef(false)
  const [error, setError] = useState<string | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  useEffect(() => {
    onTitleChangeRef.current = onTitleChange
  }, [onTitleChange])

  useEffect(() => {
    onContentInspectRef.current = onContentInspect
  }, [onContentInspect])

  // ввод работает, только если клик попал в сам текст: нажатие по padding/пустой
  // зоне рамки оставляло фокус на <body>, и введённые символы терялись
  const focusEditorText = () => {
    const root = holder.current?.querySelector('affine-page-root') as
      | { focusFirstParagraph?: () => void }
      | null
    root?.focusFirstParagraph?.()
  }

  useEffect(() => {
    let disposed = false
    const el = holder.current
    ;(async () => {
      try {
        const withTitle = onTitleChangeRef.current !== undefined
        let initialTitle = title ?? ''
        const [{ PageEditor }, storeMod, { AffineSchemas }, blocksMod, { setupBlocksuite }, customBlocksMod] = await Promise.all([
          import('@blocksuite/presets'),
          import('@blocksuite/store'),
          import('@blocksuite/blocks/schemas'),
          import('@blocksuite/blocks'),
          import('@/lib/blocksuiteSetup'),
          import('@/lib/customBlocks'),
        ])
        await setupBlocksuite()
        await customBlocksMod.registerCustomSlashMenuItems()
        if (disposed || !el) return

        const { DocCollection, Schema, Job } = storeMod
        const { MarkdownAdapter } = blocksMod
        const schema = new Schema()
        // схема affine:note имеет явный список children — расширяем его нашими блоками,
        // иначе валидация отклоняет «affine:carousel/poll cannot have parent affine:note»
        const extendedSchemas = AffineSchemas.map((s) =>
          s.model.flavour === 'affine:note'
            ? {
                ...s,
                model: {
                  ...s.model,
                  children: [...(s.model.children ?? []), 'affine:carousel', 'affine:poll', 'affine:callout', 'affine:userblock', 'affine:ivideo', 'affine:faq', 'affine:actionbutton'],
                },
              }
            : s,
        )
        schema.register(extendedSchemas)
        schema.register(customBlocksMod.customBlockSchemas)
        const collection = new DocCollection({ schema, id: `indie-${roomId ?? `solo-${Date.now()}`}` })
        // без этого collection.meta._proxy.pages остаётся undefined: addDocMeta молча
        // не добавляет запись, blockCollections не заполняется, createDoc() возвращает null
        collection.meta.initialize()
        const job = new Job({ collection })
        const adapter = new MarkdownAdapter(job, [
          ...blocksMod.defaultBlockMarkdownAdapterMatchers,
          ...customBlocksMod.customMarkdownMatchers,
        ])

        // официальный паттерн (react-basic): пустой doc получает базовые блоки в initFn load()
        const createEmptyDoc = (id: string): Doc => {
          const d = collection.createDoc({ id })
          d.load(() => {
            const pageBlockId = d.addBlock('affine:page', {})
            d.addBlock('affine:surface', {}, pageBlockId)
            const noteId = d.addBlock('affine:note', {}, pageBlockId)
            d.addBlock('affine:paragraph', {}, noteId)
          })
          return d
        }

        const loadMarkdown = async (md: string): Promise<Doc | undefined> => {
          if (!md.trim()) return undefined
          try {
            let body = md
            if (withTitle) {
              // ведущая `# Title`-строка — это page-title root-блока, а не h1 в теле:
              // отрезаем её, чтобы при round-trip заголовок не дублировался абзацем
              const m = md.match(/^#\s+(.*)(?:\n+|$)/)
              if (m) {
                if (!initialTitle) initialTitle = m[1].trim()
                body = md.slice(m[0].length)
              }
            }
            const snap = await adapter.toDocSnapshot({ file: body })
            return await job.snapshotToDoc(snap) // snapshotToDoc сам делает doc.load()
          } catch {
            return undefined
          }
        }

        // комната: сначала пустой doc, ждём состояние от других вкладок;
        // если никто не ответил — инициализируемся из markdown сами
        let doc: Doc | undefined
        if (roomId) {
          doc = createEmptyDoc(`room-${roomId}`)
          const { connectBroadcastDoc } = await import('@/lib/broadcastSync')
          const conn = connectBroadcastDoc(doc.spaceDoc, roomId)
          syncRef.current = conn
          const hasPeer = await conn.ready
          if (disposed) return
          if (!hasPeer && value.trim()) {
            const loaded = await loadMarkdown(value)
            if (loaded) {
              // переносим состояние загруженного doc в комнатный doc
              const Y = await import('yjs')
              Y.applyUpdate(doc.spaceDoc, Y.encodeStateAsUpdate(loaded.spaceDoc), { local: true })
            }
          }
        } else {
          doc = await loadMarkdown(value)
          if (!doc) {
            doc = createEmptyDoc(`doc-${Date.now()}`)
          }
        }
        if (disposed || !el) return

        // @mention-автодополнение: работает и в полном редакторе, и в compact-комментариях
        const { attachMentions } = await import('@/lib/mentions')
        const detachMentions = attachMentions(el)
        mentionsRef.current = detachMentions
        if (disposed) {
          detachMentions()
          return
        }
        // начальный заголовок кладём в title root-блока (настоящий page-title)
        const rootTitle = (doc.root as unknown as { title?: { length: number; insert: (c: string, i: number) => void; toString: () => string } } | null)?.title
        if (withTitle && initialTitle && rootTitle && rootTitle.length === 0) {
          rootTitle.insert(initialTitle, 0)
        }

        // у не-Premium Premium-блоки (вставка, drag&drop, черновик) сразу становятся текстом
        // комментарии: блоки статьи (FAQ, интерактивное видео) там недоступны
        if (compact) customBlocksMod.markCompactDoc(doc)
        const detachGuard = customBlocksMod.attachPremiumGuard(doc as never, storeMod.Text as never)
        guardRef.current = detachGuard

        // editor.doc/specs ДО appendChild: connectedCallback читает doc.slots
        const editor = new PageEditor()
        // встроенное меню «@ / [[» BlockSuite — ссылки на документы и «Create doc»; документ у нас один,
        // а «@» — упоминание людей (lib/mentions.ts): триггеры меню документов выключены
        const { ConfigExtension } = await import('@blocksuite/block-std')
        editor.specs = [
          ...blocksMod.PageEditorBlockSpecs,
          ...customBlocksMod.customBlockSpecs,
          ConfigExtension('affine:page', { linkedWidget: { triggerKeys: [] } }),
        ]
        editor.doc = doc
        el.appendChild(editor)

        // поддерживаемый page-title: <doc-title> из @blocksuite/presets живёт
        // внутри .affine-page-viewport рядом с editor-host (как в AFFiNE)
        if (withTitle) {
          void (async () => {
            for (let i = 0; i < 100; i++) {
              if (disposed) return
              const viewport = editor.querySelector('.affine-page-viewport')
              if (viewport) {
                if (!viewport.querySelector('doc-title')) {
                  const titleEl = document.createElement('doc-title') as HTMLElement & { doc: Doc }
                  titleEl.doc = doc
                  viewport.prepend(titleEl)
                }
                return
              }
              await new Promise((r) => setTimeout(r, 100))
            }
          })()
        }

        const serialize = async (): Promise<string> => {
          try {
            const snap = job.docToSnapshot(doc)
            if (!snap) return lastSerialized.current
            const { file } = await adapter.fromDocSnapshot({ snapshot: snap })
            return file ?? ''
          } catch {
            return lastSerialized.current
          }
        }
        const inspectContent = () => {
          let hasVideo = false
          const walk = (model: { flavour: string; children?: { flavour: string; children?: unknown[] }[] } | null) => {
            if (!model || hasVideo) return
            if (VIDEO_FLAVOURS.has(model.flavour)) {
              hasVideo = true
              return
            }
            for (const c of model.children ?? []) walk(c as typeof model)
          }
          walk(doc.root as Parameters<typeof walk>[0])
          if (hasVideo !== lastHasVideo.current) {
            lastHasVideo.current = hasVideo
            onContentInspectRef.current?.({ hasVideo })
          }
        }
        let timer: number | undefined
        const onYUpdate = () => {
          window.clearTimeout(timer)
          timer = window.setTimeout(() => {
            inspectContent()
            const currentTitle = (doc.root as unknown as { title?: { toString: () => string } } | null)?.title?.toString() ?? ''
            if (currentTitle !== lastTitle.current) {
              lastTitle.current = currentTitle
              onTitleChangeRef.current?.(currentTitle)
            }
            void serialize().then((md) => {
              if (md !== lastSerialized.current) {
                lastSerialized.current = md
                onChangeRef.current(md)
              }
            })
          }, 350)
        }
        doc.spaceDoc.on('update', onYUpdate)
        inspectContent()
        updateHandlerRef.current = onYUpdate
        stateRef.current = { doc }
        setReady(true)
      } catch (e) {
        if (!disposed) setError(String(e))
      }
    })()
    return () => {
      disposed = true
      mentionsRef.current?.()
      mentionsRef.current = null
      guardRef.current?.()
      guardRef.current = null
      syncRef.current?.disconnect()
      syncRef.current = null
      const st = stateRef.current
      const handler = updateHandlerRef.current
      if (st && handler) st.doc.spaceDoc.off('update', handler)
      stateRef.current = null
      el?.replaceChildren()
    }
    // редактор создаётся один раз из начального value; дальше он — источник markdown
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId])

  if (error) {
    return (
      <div className="border border-dashed border-border p-6 text-center">
        <p className="meta inline-flex items-center gap-1.5 text-accent">
          <AlertTriangle size={12} aria-hidden="true" /> Визуальный редактор не инициализировался
        </p>
        <p className="mx-auto mt-3 max-w-[52ch] text-sm text-muted-foreground">
          {error.slice(0, 160)}
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="btn-ghost mt-4 !px-4 !py-2"
        >
          Перезагрузить страницу
        </button>
      </div>
    )
  }

  return (
    <div>
      {!compact && (
        <p className="meta mb-2 inline-flex items-center gap-1.5">
          BlockSuite · PageEditor {ready ? '· готов' : '· загрузка…'}
          {roomId && (
            <span className="inline-flex items-center gap-1 text-accent">
              <Users size={11} aria-hidden="true" /> комната {roomId}: синхронизация между вкладками этого браузера
            </span>
          )}
        </p>
      )}
      <div
        ref={holder}
        onPointerDown={(e) => {
          // клик по рамке/padding вне самого редактора: без этого фокус оставался
          // на <body> и ввод терялся — переводим фокус в первый абзац
          if (!(e.target as HTMLElement).closest('page-editor, doc-title')) {
            e.preventDefault()
            focusEditorText()
          }
        }}
        // [&_page-editor]:block — без этого host-элемент остаётся display:inline
        // и min-height к нему не применяется (компактный редактор схлопывался)
        className={`blocksuite-editor ${compact ? 'blocksuite-editor--compact p-1.5' : 'p-2'} relative cursor-text rounded-md border border-input bg-background [&_page-editor]:block [&_page-editor]:min-h-[200px] ${
          compact ? '[&_page-editor]:!min-h-[120px]' : '[&_page-editor]:min-h-[400px]'
        }`}
      />
    </div>
  )
}
