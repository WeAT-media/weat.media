import { useMemo, useRef, useState } from 'react'
import { FlaskConical, ListVideo } from 'lucide-react'
import VideoPlayer, { type VideoPlayerHandle } from '@/components/VideoPlayer'
import { parseIVideo, type IVAction, type IVQuestion } from '@/lib/interactiveVideo'

const fmt = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`

/** Интерактивное видео на нашем плеере (video.js): главы, метки на кадре, вопросы с паузой и ветвление по ответу */
export default function InteractiveVideo({ raw }: { raw: string }) {
  const iv = useMemo(() => parseIVideo(raw), [raw])
  const ref = useRef<VideoPlayerHandle>(null)
  const [segId, setSegId] = useState(iv?.start ?? '')
  const [time, setTime] = useState(0)
  const [question, setQuestion] = useState<IVQuestion | null>(null)
  const [answered, setAnswered] = useState<Record<string, number>>({})
  const [feedback, setFeedback] = useState<string | null>(null)
  // куда перемотать после смены фрагмента
  const pendingSeek = useRef<number | null>(null)
  const visited = useRef(new Set<string>())

  const seg = iv?.segments.find((s) => s.id === segId) ?? iv?.segments[0]

  // новый фрагмент загрузился — перематываем, куда просили, и играем
  const onLoaded = () => {
    if (pendingSeek.current === null) return
    const t = pendingSeek.current
    pendingSeek.current = null
    ref.current?.seekTo(t)
  }

  if (!iv || !seg) return <p className="my-8 text-sm text-muted-foreground">Интерактивное видео не настроено.</p>

  const go = (id: string, t = 0) => {
    setQuestion(null)
    setFeedback(null)
    if (id === segId) {
      ref.current?.seekTo(t)
      return
    }
    pendingSeek.current = t
    setSegId(id)
  }

  const run = (a: IVAction) => {
    if (a.type === 'link') window.open(a.url, '_blank', 'noopener,noreferrer')
    else if (a.type === 'seek') go(segId, a.t)
    else go(a.id)
  }

  const onTime = (now: number) => {
    setTime(now)
    // вопрос: один раз на просмотр фрагмента, в окне ¾ секунды после своей секунды
    const q = iv.questions.find((x) => x.segment === segId && !visited.current.has(`${segId}:${x.id}`) && now >= x.t && now < x.t + 0.75)
    if (q) {
      visited.current.add(`${segId}:${q.id}`)
      ref.current?.pause()
      setQuestion(q)
    }
  }

  const onEnded = () => {
    // конец фрагмента без развилки на следующий — следующий по порядку
    const i = iv.segments.findIndex((s) => s.id === segId)
    const next = iv.segments[i + 1]
    if (next && !iv.questions.some((q) => q.options.some((o) => o.goto === next.id))) go(next.id)
  }

  const answer = (q: IVQuestion, i: number) => {
    const o = q.options[i]!
    setAnswered((a) => ({ ...a, [q.id]: i }))
    const quiz = q.options.some((x) => x.correct)
    if (o.goto) return go(o.goto)
    if (quiz) setFeedback(o.correct ? 'Верно!' : `Правильный ответ: ${q.options.find((x) => x.correct)!.label}`)
    else {
      setQuestion(null)
      ref.current?.play()
    }
  }

  const chapters = iv.chapters
  const current = [...chapters].reverse().find((c) => c.segment === segId && c.t <= time)
  const hotspots = iv.hotspots.filter((h) => h.segment === segId && time >= h.from && time <= h.to)

  return (
    <figure className="my-8">
      <p className="meta mb-2 inline-flex items-center gap-1.5">
        <FlaskConical size={11} className="text-accent" aria-hidden="true" /> Интерактивное видео · developer preview
      </p>
      <div className="grid gap-4 lg:grid-cols-[1fr_220px]">
        <VideoPlayer
          ref={ref}
          src={seg.src}
          title={seg.title}
          caption={false}
          onTime={onTime}
          onEnded={onEnded}
          onLoaded={onLoaded}
          overlay={
            <>
          {hotspots.map((h, i) => (
            <button
              key={i}
              type="button"
              onClick={() => run(h.action)}
              style={{ left: `${h.x}%`, top: `${h.y}%` }}
              className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent px-3 py-1.5 text-xs font-semibold text-accent-foreground shadow-lg ring-2 ring-white/70 transition-transform hover:scale-105"
            >
              {h.label}
            </button>
          ))}
          {question && (
            <div role="dialog" aria-label="Вопрос" className="absolute inset-0 flex items-center justify-center bg-black/70 p-4">
              <div className="w-full max-w-md rounded-md bg-background p-5">
                <p className="text-lg font-extrabold tracking-tight">{question.prompt}</p>
                <div className="mt-4 grid gap-2">
                  {question.options.map((o, i) => (
                    <button
                      key={i}
                      type="button"
                      disabled={feedback !== null}
                      onClick={() => answer(question, i)}
                      className={`btn-ghost justify-start !py-2 text-left ${answered[question.id] === i ? '!border-accent !text-accent' : ''}`}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
                {feedback && (
                  <div className="mt-4 flex items-center justify-between gap-3">
                    <p className="text-sm font-semibold">{feedback}</p>
                    <button type="button" className="btn-primary !py-1.5" onClick={() => go(segId, question.t + 0.8)}>
                      Продолжить
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
            </>
          }
        />
        {chapters.length > 0 && (
          <nav aria-label="Главы видео" className="border border-border p-3">
            <p className="meta inline-flex items-center gap-1.5"><ListVideo size={11} aria-hidden="true" /> Главы</p>
            <ol className="mt-2 space-y-1">
              {chapters.map((c, i) => {
                const active = c === current
                return (
                  <li key={i}>
                    <button
                      type="button"
                      onClick={() => go(c.segment, c.t)}
                      aria-current={active ? 'step' : undefined}
                      className={`flex w-full gap-2 rounded px-2 py-1 text-left text-sm hover:bg-secondary ${active ? 'bg-secondary font-semibold text-accent' : ''}`}
                    >
                      <span className="font-mono text-xs text-muted-foreground">{fmt(c.t)}</span>
                      <span className="min-w-0 flex-1">{c.title}</span>
                    </button>
                  </li>
                )
              })}
            </ol>
          </nav>
        )}
      </div>
      <figcaption className="meta mt-2 !normal-case tracking-normal">Фрагмент: {seg.title}</figcaption>
    </figure>
  )
}
