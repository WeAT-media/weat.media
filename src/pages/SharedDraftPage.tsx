import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router'
import { Clock, LogIn, Users } from 'lucide-react'
import { useStore } from '@/lib/store'
import BlocksEditor from '@/components/BlocksEditor'
import { ApiError, shared, type SharedDraftView, type SharedPerson } from '@/lib/api'

const who = (p: SharedPerson) => p.displayName || (p.handle ? `@${p.handle}` : p.did.slice(0, 16))

/**
 * Совместное редактирование черновика по ссылке (24 ч). Только для вошедших: правки видят все участники,
 * кто поменял текст — рецензент статьи (имя попадёт в опубликованную запись).
 */
export default function SharedDraftPage() {
  const { token = '' } = useParams()
  const { user } = useStore()
  const [view, setView] = useState<SharedDraftView | null>(null)
  const [error, setError] = useState<{ status: number; message: string } | null>(null)
  const [status, setStatus] = useState<'ok' | 'offline' | 'expired' | 'waiting'>('ok')
  const [title, setTitle] = useState('')
  const latest = useRef({ title: '', text: '' })
  const saveTimer = useRef<number | undefined>(undefined)

  useEffect(() => {
    if (!user || !token) return
    shared.get(token).then(
      (v) => {
        setView(v)
        setTitle(v.title)
        latest.current = { title: v.title, text: v.text }
      },
      (e) => setError({ status: e instanceof ApiError ? e.status : 0, message: e instanceof Error ? e.message : 'Не удалось открыть' }),
    )
  }, [user, token])

  // рецензенты обновляются раз в 20 с — видно, кто уже правил
  useEffect(() => {
    if (!view) return
    const t = window.setInterval(() => void shared.get(token).then((v) => setView((cur) => (cur ? { ...cur, reviewers: v.reviewers } : v)), () => {}), 20_000)
    return () => window.clearInterval(t)
  }, [view?.token, token]) // eslint-disable-line react-hooks/exhaustive-deps

  // markdown черновика у автора — свежий: сохраняем через 2 с после правки
  const scheduleSave = () => {
    window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => void shared.saveText(token, latest.current).catch(() => {}), 2000)
  }
  useEffect(() => () => window.clearTimeout(saveTimer.current), [])

  if (!user) {
    return (
      <div className="mx-auto max-w-[560px] px-5 py-24 text-center">
        <p className="meta">Совместное редактирование</p>
        <h1 className="mt-4 text-3xl font-extrabold tracking-tight">Войдите, чтобы открыть черновик</h1>
        <p className="mt-3 text-muted-foreground">Черновик по ссылке видят и правят только зарегистрированные пользователи.</p>
        <Link to={`/login?${new URLSearchParams({ returnTo: `/shared-draft/${token}` })}`} className="btn-primary mt-8">
          <LogIn size={15} aria-hidden="true" /> Войти
        </Link>
      </div>
    )
  }

  if (error || status === 'expired') {
    const expired = status === 'expired' || error?.status === 410
    return (
      <div className="mx-auto max-w-[720px] px-5 py-24 text-center">
        <p className="meta">{expired ? 'Ссылка истекла' : 'Ссылка недействительна'}</p>
        <h1 className="mt-4 text-3xl font-extrabold tracking-tight">{expired ? 'Срок ссылки закончился' : 'Черновик не найден'}</h1>
        <p className="mt-3 text-muted-foreground">
          {expired ? 'Ссылки для совместного редактирования живут 24 часа и закрываются после публикации.' : error?.message}
        </p>
        <Link to="/feed" className="btn-ghost mt-8">К ленте</Link>
      </div>
    )
  }

  if (!view) return <p className="meta mx-auto max-w-[44rem] px-5 py-24">Открываем черновик…</p>

  const expires = new Date(view.expiresAt).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

  return (
    <div className="mx-auto max-w-[1200px] px-5 pb-24 md:px-8">
      <div className="mx-auto max-w-[44rem] pt-10">
        <p className="meta inline-flex flex-wrap items-center gap-1.5 border border-dashed border-accent px-3 py-2 text-accent">
          <Clock size={12} aria-hidden="true" /> Совместное редактирование · черновик {who(view.owner)} · ссылка до {expires}
        </p>
        <p className="mt-4 max-w-[62ch] text-sm leading-relaxed text-muted-foreground">
          {view.isOwner
            ? 'Это ваш черновик: правки участников приходят сюда и в редактор публикации. Кто поменял текст — станет рецензентом статьи.'
            : 'Правки видят все, кто открыл ссылку, и автор. Если вы поменяете текст, при публикации вас укажут рецензентом статьи.'}
        </p>

        <section aria-label="Рецензенты" className="mt-4">
          <p className="meta inline-flex items-center gap-1.5">
            <Users size={12} aria-hidden="true" /> Рецензенты:{' '}
            {view.reviewers.length ? view.reviewers.map(who).join(', ') : 'пока никто не правил'}
          </p>
        </section>

        {status === 'offline' && <p role="status" className="mt-3 text-sm text-destructive">Нет связи с сервером — правки сохранятся, когда она вернётся.</p>}
        {status === 'waiting' && <p role="status" className="meta mt-3">Ждём, пока автор откроет черновик…</p>}

        <div className="mt-6">
          <BlocksEditor
            value={view.text}
            title={title}
            onTitleChange={(t) => {
              setTitle(t)
              latest.current = { ...latest.current, title: t }
              scheduleSave()
            }}
            onChange={(md) => {
              latest.current = { ...latest.current, text: md }
              scheduleSave()
            }}
            serverRoom={{ token, isOwner: view.isOwner, onStatus: setStatus }}
          />
        </div>
      </div>
    </div>
  )
}
