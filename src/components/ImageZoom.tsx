import { useEffect, useState, type MouseEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'

/**
 * Увеличение картинок статьи по клику или тапу. Обработчик один на весь текст (делегирование): картинки
 * из блоков, из inline-разметки и внутри своих блоков. Картинка-ссылка открывает ссылку, а не просмотр.
 * В просмотре картинка вписана в окно; повторный клик — в натуральную величину с прокруткой (на телефоне
 * работает и жест «щипок»). Закрыть — Esc, крестик или клик по фону.
 */
export default function ImageZoom({ children }: { children: ReactNode }) {
  const [img, setImg] = useState<{ src: string; alt: string } | null>(null)
  const [full, setFull] = useState(false)

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
    setFull(false)
    setImg({ src: t.currentSrc || t.src, alt: t.alt })
  }

  return (
    <>
      <div onClick={onClick} className="[&_img]:cursor-zoom-in [&_a_img]:cursor-pointer">
        {children}
      </div>
      {img &&
        createPortal(
          <div
            role="dialog"
            aria-modal="true"
            aria-label={img.alt || 'Картинка'}
            onClick={(e) => e.target === e.currentTarget && setImg(null)}
            className={`fixed inset-0 z-[1100] bg-black/85 [touch-action:pinch-zoom] ${full ? 'overflow-auto' : 'flex items-center justify-center p-4'}`}
          >
            <img
              src={img.src}
              alt={img.alt}
              referrerPolicy="no-referrer"
              onClick={() => setFull((f) => !f)}
              className={full ? 'max-w-none cursor-zoom-out' : 'max-h-full max-w-full cursor-zoom-in object-contain'}
            />
            {img.alt && !full && (
              <p className="pointer-events-none absolute inset-x-4 bottom-4 text-center text-sm text-white/80">{img.alt}</p>
            )}
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
