import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type ReactNode } from 'react'
import { videoTracker } from '@/lib/tracking'
import { RESUME_MIN_S, RESUME_TAIL_S, clearResume, clock, getResume, saveResume } from '@/lib/videoResume'
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
  /** id статьи для аналитики: запуск и досмотр видео (ранжирование видео) */
  trackId?: string
  /** ключ ролика для «продолжить с места»; без него (превью, интерактивное видео) — всегда с начала */
  resumeKey?: string
  /** позиция из аккаунта (смотрел на другом устройстве) */
  resumeRemote?: { t: number; at: number }
  /** позиция для аккаунта: на паузе, раз в 30 с и при уходе со страницы; 0 — досмотрен или с начала */
  onSyncProgress?: (t: number, duration: number) => void
}

const typeOf = (src: string) => (/\.webm(\?|$)/i.test(src) ? 'video/webm' : 'video/mp4')

/** Плеер на video.js. Источник меняется без пересоздания плеера (нужно для ветвления интерактивного видео). */
const VideoPlayer = forwardRef<VideoPlayerHandle, Props>(function VideoPlayer(
  { src, title, previewRange, onPreviewEnd, onTime, onEnded, onLoaded, overlay, caption, trackId, resumeKey, resumeRemote, onSyncProgress },
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
  const initialTrackId = useRef(trackId)
  const initialResumeKey = useRef(resumeKey)
  const initialResumeRemote = useRef(resumeRemote)
  const syncRef = useRef(onSyncProgress)
  useEffect(() => {
    syncRef.current = onSyncProgress
  }, [onSyncProgress])
  /** с какой секунды продолжили — плашка «Продолжаем с … · С начала» */
  const [resumedAt, setResumedAt] = useState<number | null>(null)

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
    // аналитика видео: трекер на ролик — один запуск и один досмотр за показ плеера
    const track = initialTrackId.current ? videoTracker(initialTrackId.current) : null
    if (track) {
      player.on('play', () => track.onPlay())
      player.on('timeupdate', () => track.onTime(player.currentTime() ?? 0, player.duration() ?? 0))
    }
    player.on('ended', () => cb.current.onEnded?.())
    player.on('loadedmetadata', () => cb.current.onLoaded?.())

    // продолжить с места: у платного превью свой отрезок — там позицию не трогаем
    const rk = previewStart === undefined ? initialResumeKey.current : undefined
    if (rk) {
      let lastSave = 0
      player.on('loadedmetadata', () => {
        const t = getResume(rk, player.duration() ?? 0, initialResumeRemote.current)
        if (t !== null) {
          player.currentTime(t)
          setResumedAt(t)
          // посмотрел пару секунд — плашка больше не нужна
          player.one('play', () => setTimeout(() => setResumedAt(null), 6_000))
        }
      })
      let lastSync = Date.now()
      const save = () => saveResume(rk, player.currentTime() ?? 0, player.duration() ?? 0)
      // в аккаунт — та же позиция, но с теми же правилами начала и хвоста (иначе t = 0: забыть)
      const sync = () => {
        lastSync = Date.now()
        const t = player.currentTime() ?? 0
        const d = player.duration() ?? 0
        syncRef.current?.(t >= RESUME_MIN_S && (!d || t < d - RESUME_TAIL_S) ? t : 0, d)
      }
      player.on('timeupdate', () => {
        const now = Date.now()
        if (now - lastSave >= 5_000) {
          lastSave = now
          save()
        }
        if (now - lastSync >= 30_000) sync()
      })
      player.on('pause', () => {
        save()
        sync()
      })
      player.on('ended', () => {
        clearResume(rk)
        syncRef.current?.(0, player.duration() ?? 0)
      })
      // закрыли вкладку посреди ролика — позиция всё равно сохранится
      const leave = () => {
        save()
        if (!player.paused()) sync()
      }
      window.addEventListener('pagehide', leave)
      player.on('dispose', () => window.removeEventListener('pagehide', leave))
    }

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
        {resumedAt !== null && (
          <div className="absolute left-3 top-3 z-20 inline-flex items-center gap-3 rounded-full bg-primary/90 px-3 py-1.5 font-mono text-[11px] font-semibold text-primary-foreground shadow-xs">
            <span>Продолжаем с {clock(resumedAt)}</span>
            <button
              type="button"
              onClick={() => {
                playerRef.current?.currentTime(0)
                if (initialResumeKey.current) clearResume(initialResumeKey.current)
                syncRef.current?.(0, playerRef.current?.duration() ?? 0)
                setResumedAt(null)
              }}
              className="cursor-pointer text-accent underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              С начала
            </button>
            <button
              type="button"
              aria-label="Скрыть"
              onClick={() => setResumedAt(null)}
              className="cursor-pointer opacity-70 hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              ×
            </button>
          </div>
        )}
        {/* над кадром, но выше панели управления (≈3em) — она остаётся кликабельной */}
        {overlay && <div className="pointer-events-none absolute inset-x-0 bottom-[3em] top-0 z-10 [&>*]:pointer-events-auto">{overlay}</div>}
      </div>
      {caption !== false && <figcaption className="meta mt-2">{caption ?? `${title} · видеоплеер video.js`}</figcaption>}
    </figure>
  )
})

export default VideoPlayer
