import { useState, type FormEvent, type ReactNode } from 'react'
import { Link } from 'react-router'
import { Check } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { useStore } from '@/lib/store'
import type { ReportReason, ReportTargetType } from '@/types/types'

const reasons: { key: ReportReason; label: string }[] = [
  { key: 'spam', label: 'Спам' },
  { key: 'harassment', label: 'Травля' },
  { key: 'illegal', label: 'Незаконный контент' },
  { key: 'copyright', label: 'Авторские права' },
  { key: 'other', label: 'Другое' },
]

const targetNames: Record<ReportTargetType, string> = {
  article: 'статью',
  comment: 'комментарий',
  user: 'пользователя',
}

/**
 * Жалоба на статью/комментарий/пользователя. Для статей судебный сценарий
 * остаётся отдельным — жалоба уходит модерации, дело не создаётся.
 * Гость получает login prompt вместо формы.
 */
export default function ReportDialog({
  targetType,
  targetId,
  targetLabel,
  trigger,
}: {
  targetType: ReportTargetType
  targetId: string
  targetLabel: string
  trigger: ReactNode
}) {
  const { user, addReport } = useStore()
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState<ReportReason>('spam')
  const [details, setDetails] = useState('')
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  const reset = () => {
    setReason('spam')
    setDetails('')
    setError('')
    setDone(false)
  }

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (reason === 'other' && details.trim().length < 5) {
      setError('Для «Другое» опишите суть — минимум 5 символов.')
      return
    }
    addReport({
      targetType,
      targetId,
      targetLabel,
      reason,
      details: details.trim(),
      reporterHandle: user?.handle ?? 'anon',
    })
    setDone(true)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v)
        if (!v) reset()
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Пожаловаться на {targetNames[targetType]}</DialogTitle>
          <DialogDescription className="line-clamp-2">«{targetLabel}»</DialogDescription>
        </DialogHeader>

        {!user ? (
          <div className="py-2">
            <p className="text-sm leading-relaxed text-muted-foreground">
              Жалобы привязаны к аккаунту, чтобы модерация могла уточнить детали. Войдите — и вернитесь сюда.
            </p>
            <Link to="/login" onClick={() => setOpen(false)} className="btn-primary mt-5">
              Войти
            </Link>
          </div>
        ) : done ? (
          <div className="py-2">
            <p className="inline-flex items-center gap-2 text-[15px] font-semibold text-accent">
              <Check size={16} aria-hidden="true" /> Жалоба передана модерации
            </p>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              Статус «на рассмотрении». Судебное дело по жалобе на пользователя или комментарий не создаётся
              автоматически — решение принимает модерация; статьи по-прежнему можно вынести на суд коллегии.
            </p>
          </div>
        ) : (
          <form onSubmit={submit} noValidate className="space-y-4">
            <fieldset>
              <legend className="meta">Причина</legend>
              <div className="mt-2 flex flex-wrap gap-2">
                {reasons.map((r) => (
                  <button
                    key={r.key}
                    type="button"
                    onClick={() => setReason(r.key)}
                    aria-pressed={reason === r.key}
                    className={`cursor-pointer rounded-full border px-3 py-1 font-mono text-[12px] font-semibold tracking-[0.04em] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                      reason === r.key
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-border text-foreground hover:border-accent hover:text-accent'
                    }`}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
            </fieldset>
            <div>
              <label htmlFor="report-details" className="meta">
                Описание{reason === 'other' ? ' · обязательно' : ' · необязательно'}
              </label>
              <textarea
                id="report-details"
                value={details}
                onChange={(e) => {
                  setDetails(e.target.value)
                  if (error) setError('')
                }}
                rows={3}
                className="mt-2 w-full resize-y rounded-md border border-input bg-background px-4 py-3 text-[14px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                placeholder="Что именно нарушает правила?"
              />
              {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
            </div>
            <button type="submit" className="btn-primary">
              Отправить жалобу
            </button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
