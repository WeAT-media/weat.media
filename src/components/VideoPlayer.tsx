import { forwardRef, useEffect, useImperativeHandle, useRef, type ReactNode } from 'react'
import videojs from 'video.js'
import 'video.js/dist/video-js.css'

export interface VideoPlayerHandle {
  /** Перемотать к секунде и попробовать начать воспроизведение */
  seekTo: (seconds: number) => void
  play: () => void
  pause: () => void
}

interface Props {
  src: string
  title: string
  /** Бесплатный превью-отрезок платного видео (секунды): воспроизведение и перемотка ограничены */
  previewRange?: { start: number; end: number }
  /** Срабатывает, когда превью доиграно до конца отрезка */
  onPreviewEnd?: () => void
  /** интерактивное видео: время, конец ролика, готовность нового источника */
  onTime?: (seconds: number) => void
  onEnded?: () => void
  onLoaded?: () => void
  /** слой поверх кадра (метки, вопросы); панель управления остаётся доступной */
  overlay?: ReactNode
  /** подпись под плеером; false — без неё */
  caption?: string | false
}

const typeOf = (src: string) => (/\.webm(\?|$)/i.test(src) ? 'video/webm' : 'video/mp4')

/** Плеер на video.js. Источник меняется без пересоздания плеера (нужно для ветвления интерактивного видео). */
const VideoPlayer = forwardRef<VideoPlayerHandle, Props>(function VideoPlayer(
  { src, title, previewRange, onPreviewEnd, onTime, onEnded, onLoaded, overlay, caption },
  ref,
) {
  const holder = useRef<HTMLDivElement>(null)
  const playerRef = useRef<ReturnType<typeof videojs> | null>(null)
  // колбэки — через ref: плеер создаётся один раз, а обработчики меняются при каждом рендере
  const cb = useRef({ onPreviewEnd, onTime, onEnded, onLoaded })
  useEffect(() => {
    cb.current = { onPreviewEnd, onTime, onEnded, onLoaded }
  }, [onPreviewEnd, onTime, onEnded, onLoaded])
  const initialSrc = useRef(src)

  useImperativeHandle(
    ref,
    () => ({
      seekTo: (seconds) => {
        const player = playerRef.current
        if (!player) return
        // плеер инициализируется асинхронно — ready() гарантирует готовность
        player.ready(() => {
          player.currentTime(seconds)
          // если автоплей заблокирован — позиция всё равно уже выставлена
          player.play()?.catch(() => {})
        })
      },
      play: () => void playerRef.current?.play()?.catch(() => {}),
      pause: () => playerRef.current?.pause(),
    }),
    [],
  )

  const previewStart = previewRange?.start
  const previewEnd = previewRange?.end

  useEffect(() => {
    if (!holder.current || playerRef.current) return
    const el = document.createElement('video-js')
    el.classList.add('vjs-big-play-centered', 'vjs-theme-indie')
    holder.current.appendChild(el)
    const player = videojs(el, {
      controls: true,
      fluid: true,
      preload: 'metadata',
      sources: [{ src: initialSrc.current, type: typeOf(initialSrc.current) }],
      playbackRates: [0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3],
    })
    playerRef.current = player

    player.on('timeupdate', () => cb.current.onTime?.(player.currentTime() ?? 0))
    player.on('ended', () => cb.current.onEnded?.())
    player.on('loadedmetadata', () => cb.current.onLoaded?.())

    if (previewStart !== undefined && previewEnd !== undefined) {
      player.on('loadedmetadata', () => player.currentTime(previewStart))
      player.on('timeupdate', () => {
        if ((player.currentTime() ?? 0) >= previewEnd) {
          player.pause()
          player.currentTime(previewEnd)
          cb.current.onPreviewEnd?.()
        }
      })
      player.on('seeking', () => {
        if ((player.currentTime() ?? 0) > previewEnd) player.currentTime(previewEnd)
      })
    }

    return () => {
      player.dispose()
      playerRef.current = null
    }
  }, [previewStart, previewEnd])

  // смена источника — тем же плеером
  useEffect(() => {
    const player = playerRef.current
    if (!player || initialSrc.current === src) return
    initialSrc.current = src
    player.src({ src, type: typeOf(src) })
  }, [src])

  return (
    <figure className="my-8">
      <div className="relative">
        <div ref={holder} data-vjs-player className="overflow-hidden rounded-md" />
        {/* над кадром, но выше панели управления (≈3em) — она остаётся кликабельной */}
        {overlay && <div className="pointer-events-none absolute inset-x-0 bottom-[3em] top-0 z-10 [&>*]:pointer-events-auto">{overlay}</div>}
      </div>
      {caption !== false && <figcaption className="meta mt-2">{caption ?? `${title} · видеоплеер video.js`}</figcaption>}
    </figure>
  )
})

export default VideoPlayer
