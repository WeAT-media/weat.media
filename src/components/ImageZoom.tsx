import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Download, RotateCcw, RotateCw, X, ZoomIn, ZoomOut } from 'lucide-react'

/**
 * Увеличение картинок статьи по клику или тапу. Обработчик один на весь текст (делегирование): картинки
 * из блоков, из inline-разметки и внутри своих блоков. Картинка-ссылка открывает ссылку, а не просмотр.
 * В просмотре картинка вписана в окно; клик по ней — увеличение к точке клика с прокруткой, ещё клик —
 * обратно (на телефоне работает и жест «щипок»). Внизу, как в Telegram, — подпись и кнопки: повернуть, масштаб, скачать.
 * Закрыть — Esc, крестик или клик по фону.
 */

/** имя файла для скачивания: последний сегмент адреса (или адреса внутри image-proxy) */
function fileName(src: string): string {
  try {
    const u = new URL(src, location.href)
    const inner = u.pathname.endsWith('/image-proxy') ? new URL(u.searchParams.get('url') ?? '') : u
    const last = decodeURIComponent(inner.pathname.split('/').filter(Boolean).pop() ?? '')
    return /\.\w{2,5}$/.test(last) ? last : `${last || 'image'}.jpg`
  } catch {
    return 'image.jpg'
  }
}

/**
 * Скачивание: атрибут download у чужого адреса браузер игнорирует, поэтому берём файл как blob.
 * Свой адрес и PDS — напрямую; чужой сайт CSP (connect-src) не пустит — через /api/image-proxy.
 * Не вышло — открываем картинку в новой вкладке.
 */
async function download(src: string) {
  const abs = new URL(src, location.href)
  const direct = abs.origin === location.origin || /(^|\.)weat\.media$/.test(abs.hostname)
  const url = direct ? abs.toString() : `/api/image-proxy?${new URLSearchParams({ url: abs.toString() })}`
  try {
    const res = await fetch(url)
    if (!res.ok) throw new Error(String(res.status))
    const blobUrl = URL.createObjectURL(await res.blob())
    const a = document.createElement('a')
    a.href = blobUrl
    a.download = fileName(src)
    document.body.append(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(blobUrl), 10_000)
  } catch {
    window.open(abs.toString(), '_blank', 'noopener,noreferrer')
  }
}

const ctl =
  'rounded-full p-2.5 text-white/85 transition-colors hover:bg-white/15 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white'

export default function ImageZoom({ children }: { children: ReactNode }) {
  const [img, setImg] = useState<{ src: string; alt: string } | null>(null)
  const [zoom, setZoom] = useState<{ w: number; fx: number; fy: number } | null>(null)
  const [turn, setTurn] = useState(0)

  useEffect(() => {
    if (!img) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setImg(null)
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = overflow
      window.removeEventListener('keydown', onKey)
    }
  }, [img])

  const onClick = (e: MouseEvent) => {
    const t = e.target
    if (!(t instanceof HTMLImageElement) || t.closest('a, button, [data-no-zoom]')) return
    e.preventDefault()
    setZoom(null)
    setTurn(0)
    setImg({ src: t.currentSrc || t.src, alt: t.alt })
  }

  // повёрнута на 90°/270° — ширина и высота меняются местами: вписываем по обратным сторонам окна
  const sideways = turn % 2 !== 0
  const fit = sideways ? { maxWidth: 'calc(100dvh - 9rem)', maxHeight: 'calc(100vw - 2rem)' } : { maxWidth: '100%', maxHeight: '100%' }

  /**
   * Увеличение: натуральная величина, но не меньше 2× вписанной (картинка меньше окна иначе «не увеличивалась»)
   * и не больше 4×; точка под курсором/пальцем остаётся под ним. Поворот возвращает к «вписать»:
   * CSS-поворот не меняет размеры прокручиваемой области, увеличенная повёрнутая картинка уезжала за край.
   */
  const scrollRef = useRef<HTMLDivElement>(null)
  const zoomIn = (el: HTMLImageElement, at?: { x: number; y: number }) => {
    const r = el.getBoundingClientRect()
    const w = Math.round(Math.min(Math.max(el.naturalWidth, r.width * 2), r.width * 4))
    const fx = at ? (at.x - r.left) / r.width : 0.5
    const fy = at ? (at.y - r.top) / r.height : 0.5
    setTurn(0)
    setZoom({ w, fx, fy })
  }
  useLayoutEffect(() => {
    const box = scrollRef.current
    if (!zoom || !box) return
    const h = (zoom.w / (box.querySelector('img')?.naturalWidth || zoom.w)) * (box.querySelector('img')?.naturalHeight || 0)
    box.scrollLeft = zoom.w * zoom.fx - box.clientWidth / 2
    box.scrollTop = h * zoom.fy - box.clientHeight / 2
  }, [zoom])
  const rotate = (d: number) => {
    setZoom(null)
    setTurn((t) => (t + d + 4) % 4)
  }

  return (
    <>
      <div onClick={onClick} className="[&_img]:cursor-zoom-in [&_a_img]:cursor-pointer">
        {children}
      </div>
      {img &&
        createPortal(
          <div role="dialog" aria-modal="true" aria-label={img.alt || 'Картинка'} className="fixed inset-0 z-[1100] flex flex-col bg-neutral-950">
            {zoom ? (
              <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto [touch-action:pan-x_pan-y_pinch-zoom]">
                {/* min-w/min-h-full + m-auto: картинка меньше области — по центру, больше — прокрутка с края */}
                <div className="flex min-h-full min-w-full">
                  <img
                    src={img.src}
                    alt={img.alt}
                    referrerPolicy="no-referrer"
                    onClick={() => setZoom(null)}
                    style={{ width: zoom.w }}
                    className="m-auto block max-w-none shrink-0 cursor-zoom-out"
                  />
                </div>
              </div>
            ) : (
              <div onClick={(e) => e.target === e.currentTarget && setImg(null)} className="flex min-h-0 flex-1 items-center justify-center p-4">
                <img
                  src={img.src}
                  alt={img.alt}
                  referrerPolicy="no-referrer"
                  onClick={(e) => zoomIn(e.currentTarget, { x: e.clientX, y: e.clientY })}
                  style={{ transform: `rotate(${turn * 90}deg)`, ...fit }}
                  className="cursor-zoom-in object-contain transition-transform duration-200"
                />
              </div>
            )}
            {/* нижняя панель: подпись слева, действия справа */}
            <div className="flex items-center gap-3 border-t border-white/10 bg-black/60 px-4 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
              <p className="min-w-0 flex-1 truncate text-sm text-white/85" title={img.alt}>{img.alt}</p>
              <div className="flex shrink-0 items-center gap-1">
                <button type="button" onClick={() => rotate(-1)} aria-label="Повернуть влево" title="Повернуть влево" className={ctl}>
                  <RotateCcw size={18} aria-hidden="true" />
                </button>
                <button type="button" onClick={() => rotate(1)} aria-label="Повернуть вправо" title="Повернуть вправо" className={ctl}>
                  <RotateCw size={18} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    const el = e.currentTarget.closest('[role=dialog]')?.querySelector('img')
                    if (zoom) setZoom(null)
                    else if (el) zoomIn(el)
                  }}
                  aria-label={zoom ? 'Вписать в окно' : 'Увеличить'}
                  title={zoom ? 'Вписать в окно' : 'Увеличить'}
                  className={ctl}
                >
                  {zoom ? <ZoomOut size={18} aria-hidden="true" /> : <ZoomIn size={18} aria-hidden="true" />}
                </button>
                <button type="button" onClick={() => void download(img.src)} aria-label="Скачать" title="Скачать" className={ctl}>
                  <Download size={18} aria-hidden="true" />
                </button>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setImg(null)}
              aria-label="Закрыть"
              autoFocus
              className="fixed right-4 top-4 rounded-full bg-black/60 p-2 text-white hover:bg-black/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
            >
              <X size={20} aria-hidden="true" />
            </button>
          </div>,
          document.body,
        )}
    </>
  )
}
