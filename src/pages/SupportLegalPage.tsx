import { useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { ArrowLeft, CheckCircle2, Scale, ShieldAlert } from 'lucide-react'
import { useStore } from '@/lib/store'
import type { SupportTicket } from '@/types/types'

const field =
  'mt-2 w-full rounded-md border border-input bg-background px-4 py-2.5 text-[15px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

/**
 * Канал для запросов официальных органов. Честное ограничение прототипа:
 * демо-тикет в localStorage; для реальных запросов нужен защищённый канал
 * с верификацией — служебные документы сюда загружать не нужно.
 */
export default function SupportLegalPage() {
  const { addSupportTicket } = useStore()
  const [org, setOrg] = useState('')
  const [position, setPosition] = useState('')
  const [email, setEmail] = useState('')
  const [requestRef, setRequestRef] = useState('')
  const [requestDate, setRequestDate] = useState('')
  const [basis, setBasis] = useState('')
  const [materialUrl, setMaterialUrl] = useState('')
  const [description, setDescription] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [ticket, setTicket] = useState<SupportTicket | null>(null)

  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState('')
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const next: Record<string, string> = {}
    if (org.trim().length < 3) next.org = 'Укажите организацию.'
    if (position.trim().length < 3) next.position = 'Укажите должность.'
    if (!/^[a-z0-9._%+-]+@[a-z0-9.-]+\.(gov|gos|mil|[a-z]{2,})$/i.test(email.trim()))
      next.email = 'Нужен официальный служебный email.'
    if (!requestRef.trim()) next.requestRef = 'Укажите номер запроса.'
    if (!requestDate) next.requestDate = 'Укажите дату запроса.'
    if (basis.trim().length < 10) next.basis = 'Правовое основание: статья закона, номер дела и т.п.'
    if (!/^(https?:\/\/|\/)/.test(materialUrl.trim())) next.materialUrl = 'Ссылка на материал: https:// или /…'
    if (description.trim().length < 20) next.description = 'Опишите запрос подробнее — минимум 20 символов.'
    if (!confirmed) next.confirmed = 'Подтвердите служебные полномочия.'
    setErrors(next)
    if (Object.keys(next).length > 0) return
    setSending(true)
    setSendError('')
    try {
      setTicket(
        await addSupportTicket({
        kind: 'legal',
        category: 'legal-request',
        email: email.trim(),
        handle: `${org.trim()} · ${position.trim()}`,
        articleUrl: materialUrl.trim(),
        subject: `Запрос ${requestRef.trim()} от ${requestDate}`,
        message: `Основание: ${basis.trim()}\n\n${description.trim()}`,
        }),
      )
    } catch (err) {
      setSendError(err instanceof Error ? err.message : 'Не удалось отправить. Попробуйте ещё раз.')
    } finally {
      setSending(false)
    }
  }

  if (ticket) {
    return (
      <div className="mx-auto max-w-[720px] px-5 py-24 text-center">
        <CheckCircle2 size={26} className="mx-auto text-accent" aria-hidden="true" />
        <p className="meta mt-4">запрос зарегистрирован</p>
        <h1 className="mt-4 text-3xl font-extrabold tracking-tight">Тикет {ticket.id}</h1>
        <p className="mx-auto mt-4 max-w-[52ch] text-[15px] leading-relaxed text-muted-foreground">
          Запрос передан сотрудникам площадки. Полномочия проверяются отдельно: мы свяжемся с вами по служебному
          email, указанному в запросе.
        </p>
        <Link to="/support" className="btn-ghost mt-8">
          <ArrowLeft size={14} aria-hidden="true" /> К поддержке
        </Link>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-[720px] px-5 pb-24 md:px-8">
      <div className="pt-10">
        <nav aria-label="Навигация по поддержке" className="flex flex-wrap items-center gap-2 font-mono text-[12px] font-semibold uppercase tracking-[0.08em]">
          <Link
            to="/support"
            className="inline-flex items-center gap-2 text-muted-foreground transition-colors hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ArrowLeft size={13} aria-hidden="true" /> Поддержка
          </Link>
          <span className="text-border" aria-hidden="true">/</span>
          <span className="meta inline-flex items-center gap-1.5">
            <Scale size={12} aria-hidden="true" /> Официальные запросы
          </span>
        </nav>
        <h1 className="mt-6 text-4xl font-extrabold tracking-tight md:text-5xl">Запрос официального органа</h1>
        <p className="mt-4 max-w-[60ch] text-[15px] leading-relaxed text-muted-foreground">
          Форма для запросов государственных органов и уполномоченных лиц. Записи авторов хранятся в их
          репозиториях AT Protocol — площадка распоряжается только агрегацией и метками.
        </p>
        <p className="mt-4 inline-flex max-w-[64ch] items-start gap-2 border border-dashed border-border bg-secondary/40 p-4 text-sm leading-relaxed text-muted-foreground">
          <ShieldAlert size={15} className="mt-0.5 shrink-0 text-accent" aria-hidden="true" />
          Документы к форме не прикладываются. После проверки полномочий мы запросим их с адреса legal@weat.media —
          туда же можно сразу направить официальный запрос.
        </p>
      </div>

      <form onSubmit={submit} noValidate className="mt-10 space-y-5">
        <p className="meta"><span className="text-destructive" aria-hidden="true">*</span> — обязательное поле</p>
        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <label htmlFor="lg-org" className="meta">Организация <span className="text-destructive" aria-hidden="true">*</span><span className="sr-only"> (обязательно)</span></label>
            <input id="lg-org" required aria-required="true" aria-invalid={!!errors.org} aria-describedby={errors.org ? "lg-org-err" : undefined} value={org} onChange={(e) => setOrg(e.target.value)} className={field} />
            {errors.org && <p id="lg-org-err" className="mt-2 text-sm text-destructive">{errors.org}</p>}
          </div>
          <div>
            <label htmlFor="lg-position" className="meta">Должность заявителя <span className="text-destructive" aria-hidden="true">*</span><span className="sr-only"> (обязательно)</span></label>
            <input id="lg-position" required aria-required="true" aria-invalid={!!errors.position} aria-describedby={errors.position ? "lg-position-err" : undefined} value={position} onChange={(e) => setPosition(e.target.value)} className={field} />
            {errors.position && <p id="lg-position-err" className="mt-2 text-sm text-destructive">{errors.position}</p>}
          </div>
        </div>
        <div>
          <label htmlFor="lg-email" className="meta">Официальный email <span className="text-destructive" aria-hidden="true">*</span><span className="sr-only"> (обязательно)</span></label>
          <input
            id="lg-email" required aria-required="true" aria-invalid={!!errors.email} aria-describedby={errors.email ? "lg-email-err" : undefined}
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="officer@agency.gov"
            className={`${field} font-mono text-sm`}
          />
          {errors.email && <p id="lg-email-err" className="mt-2 text-sm text-destructive">{errors.email}</p>}
        </div>
        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <label htmlFor="lg-ref" className="meta">Номер запроса <span className="text-destructive" aria-hidden="true">*</span><span className="sr-only"> (обязательно)</span></label>
            <input id="lg-ref" required aria-required="true" aria-invalid={!!errors.requestRef} aria-describedby={errors.requestRef ? "lg-requestRef-err" : undefined} value={requestRef} onChange={(e) => setRequestRef(e.target.value)} className={`${field} font-mono text-sm`} />
            {errors.requestRef && <p id="lg-requestRef-err" className="mt-2 text-sm text-destructive">{errors.requestRef}</p>}
          </div>
          <div>
            <label htmlFor="lg-date" className="meta">Дата запроса <span className="text-destructive" aria-hidden="true">*</span><span className="sr-only"> (обязательно)</span></label>
            <input id="lg-date" required aria-required="true" aria-invalid={!!errors.requestDate} aria-describedby={errors.requestDate ? "lg-requestDate-err" : undefined} type="date" value={requestDate} onChange={(e) => setRequestDate(e.target.value)} className={`${field} font-mono text-sm`} />
            {errors.requestDate && <p id="lg-requestDate-err" className="mt-2 text-sm text-destructive">{errors.requestDate}</p>}
          </div>
        </div>
        <div>
          <label htmlFor="lg-basis" className="meta">Правовое основание <span className="text-destructive" aria-hidden="true">*</span><span className="sr-only"> (обязательно)</span></label>
          <input
            id="lg-basis" required aria-required="true" aria-invalid={!!errors.basis} aria-describedby={errors.basis ? "lg-basis-err" : undefined}
            value={basis}
            onChange={(e) => setBasis(e.target.value)}
            placeholder="Статья закона, номер дела или определения"
            className={field}
          />
          {errors.basis && <p id="lg-basis-err" className="mt-2 text-sm text-destructive">{errors.basis}</p>}
        </div>
        <div>
          <label htmlFor="lg-url" className="meta">Ссылка на материал <span className="text-destructive" aria-hidden="true">*</span><span className="sr-only"> (обязательно)</span></label>
          <input
            id="lg-url" required aria-required="true" aria-invalid={!!errors.materialUrl} aria-describedby={errors.materialUrl ? "lg-materialUrl-err" : undefined}
            value={materialUrl}
            onChange={(e) => setMaterialUrl(e.target.value)}
            placeholder="/article/… или https://…"
            className={`${field} font-mono text-sm`}
          />
          {errors.materialUrl && <p id="lg-materialUrl-err" className="mt-2 text-sm text-destructive">{errors.materialUrl}</p>}
        </div>
        <div>
          <label htmlFor="lg-desc" className="meta">Описание запроса <span className="text-destructive" aria-hidden="true">*</span><span className="sr-only"> (обязательно)</span></label>
          <textarea
            id="lg-desc" required aria-required="true" aria-invalid={!!errors.description} aria-describedby={errors.description ? "lg-description-err" : undefined}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={5}
            className={`${field} resize-y`}
            placeholder="Что запрашивается и в каком объёме"
          />
          {errors.description && <p id="lg-description-err" className="mt-2 text-sm text-destructive">{errors.description}</p>}
        </div>
        <label className="flex cursor-pointer items-start gap-3">
          <input
            type="checkbox"
            required
            aria-required="true"
            aria-invalid={!!errors.confirmed}
            aria-describedby={errors.confirmed ? 'lg-confirmed-err' : undefined}
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
            className="mt-1 h-4 w-4 cursor-pointer accent-[hsl(27_50%_49%)]"
          />
          <span className="text-sm leading-relaxed">
            Подтверждаю, что действую в рамках служебных полномочий и запрос соответствует указанному основанию. <span className="text-destructive" aria-hidden="true">*</span><span className="sr-only"> (обязательно)</span>
          </span>
        </label>
        {errors.confirmed && <p id="lg-confirmed-err" className="text-sm text-destructive">{errors.confirmed}</p>}
        {sendError && <p role="alert" className="text-sm text-destructive">{sendError}</p>}
        <button type="submit" className="btn-primary" disabled={sending}>{sending ? 'Отправляем…' : 'Зарегистрировать запрос'}</button>
      </form>
    </div>
  )
}
