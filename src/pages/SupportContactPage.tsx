import { useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router'
import { ArrowLeft, CheckCircle2, FileCheck } from 'lucide-react'
import { useStore } from '@/lib/store'
import { countryLabel } from '@/lib/api'
import type { SupportTicket } from '@/types/types'

const categories = [
  { key: 'not-visible', label: 'Моя статья не видна' },
  { key: 'tech', label: 'Техническая проблема' },
  { key: 'money', label: 'Монетизация и выплаты' },
  { key: 'safety', label: 'Безопасность и жалобы' },
  { key: 'country-change', label: 'Смена страны резидентства' },
  { key: 'other', label: 'Другое' },
]

const COUNTRIES = ['RU', 'KZ', 'GE', 'RS', 'AM', 'BY', 'other']
const MAX_DOC_SIZE = 10 * 1024 * 1024
const DOC_TYPES = [
  { key: 'passport', label: 'Паспорт' },
  { key: 'registration', label: 'Регистрация' },
  { key: 'residence-permit', label: 'Вид на жительство' },
  { key: 'other', label: 'Другой документ' },
] as const

const field =
  'mt-2 w-full rounded-md border border-input bg-background px-4 py-2.5 text-[15px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

/** Форма обратной связи: локальный демо-тикет, никакой отправки на backend нет */
export default function SupportContactPage() {
  const { addSupportTicket, user } = useStore()
  const [searchParams] = useSearchParams()
  const initialCategory = categories.some((c) => c.key === searchParams.get('category'))
    ? searchParams.get('category')!
    : categories[0].key
  const [category, setCategory] = useState(initialCategory)
  const [email, setEmail] = useState('')
  const [handle, setHandle] = useState('')
  const [articleUrl, setArticleUrl] = useState('')
  const [subject, setSubject] = useState('')
  const [message, setMessage] = useState('')
  const [countryFrom, setCountryFrom] = useState(user?.residenceCountry ?? user?.signupCountry ?? 'RU')
  const [countryTo, setCountryTo] = useState('')
  const [docType, setDocType] = useState<(typeof DOC_TYPES)[number]['key']>('passport')
  const [docFile, setDocFile] = useState<{ name: string; size: number; type: string } | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [ticket, setTicket] = useState<SupportTicket | null>(null)
  const isCountryChange = category === 'country-change'

  const onDocFile = (file: File | null) => {
    if (!file) return
    const okType = ['application/pdf', 'image/jpeg', 'image/png'].includes(file.type)
    if (!okType) {
      setErrors((p) => ({ ...p, docFile: 'Нужен PDF, JPG или PNG.' }))
      return
    }
    if (file.size > MAX_DOC_SIZE) {
      setErrors((p) => ({ ...p, docFile: 'Файл больше 10 МБ не принимается.' }))
      return
    }
    // сохраняем только метаданные: содержимое/base64 в localStorage не пишем
    setDocFile({ name: file.name, size: file.size, type: file.type })
    setErrors((p) => ({ ...p, docFile: '' }))
  }

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const next: Record<string, string> = {}
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim())) next.email = 'Укажите рабочий email для ответа.'
    if (isCountryChange) {
      if (!countryTo) next.countryTo = 'Выберите новую страну резидентства.'
      if (countryTo && countryTo === countryFrom) next.countryTo = 'Новая страна совпадает с текущей.'
      if (message.trim().length < 20) next.message = 'Опишите причину смены — минимум 20 символов.'
      if (!docFile) next.docFile = 'Приложите подтверждающий документ (PDF/JPG/PNG до 10 МБ).'
    } else {
      if (subject.trim().length < 5) next.subject = 'Тема короткая — минимум 5 символов.'
      if (message.trim().length < 20) next.message = 'Опишите проблему подробнее — минимум 20 символов.'
      if (category === 'not-visible' && !articleUrl.trim()) next.articleUrl = 'Для сценария «статья не видна» нужна ссылка на запись.'
      if (articleUrl.trim() && !/^(https?:\/\/|\/)/.test(articleUrl.trim())) next.articleUrl = 'Ссылка должна начинаться с https:// или /.'
    }
    setErrors(next)
    if (Object.keys(next).length > 0) return
    setTicket(
      addSupportTicket(
        isCountryChange
          ? {
              kind: 'support',
              category,
              email: email.trim(),
              handle: handle.trim() || undefined,
              subject: 'Смена страны резидентства',
              message: message.trim(),
              countryFrom,
              countryTo,
              docType,
              docFile: docFile ?? undefined,
              status: 'verification-pending',
            }
          : {
              kind: 'support',
              category,
              email: email.trim(),
              handle: handle.trim() || undefined,
              articleUrl: articleUrl.trim() || undefined,
              subject: subject.trim(),
              message: message.trim(),
            },
      ),
    )
  }

  if (ticket) {
    const pending = ticket.status === 'verification-pending'
    return (
      <div className="mx-auto max-w-[720px] px-5 py-24 text-center">
        {pending ? (
          <FileCheck size={26} className="mx-auto text-accent" aria-hidden="true" />
        ) : (
          <CheckCircle2 size={26} className="mx-auto text-accent" aria-hidden="true" />
        )}
        <p className="meta mt-4">{pending ? 'ожидает проверки документов' : 'обращение зарегистрировано'}</p>
        <h1 className="mt-4 text-3xl font-extrabold tracking-tight">Тикет {ticket.id}</h1>
        <p className="mx-auto mt-4 max-w-[52ch] text-[15px] leading-relaxed text-muted-foreground">
          {pending
            ? 'Заявка на смену страны резидентства принята (verification-pending): документы будут проверены вручную, страна профиля не меняется автоматически. Это демонстрационный прототип: тикет и метаданные файла сохранены локально, содержимое документа никуда не отправлено.'
            : `Это демонстрационный прототип: тикет сохранён локально в вашем браузере (статус «received-demo») и никуда не отправлен. В боевой версии ответ пришёл бы на ${ticket.email}.`}
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
        <Link
          to="/support"
          className="inline-flex items-center gap-2 font-mono text-[12px] font-semibold uppercase tracking-[0.08em] text-muted-foreground transition-colors hover:text-accent"
        >
          <ArrowLeft size={13} aria-hidden="true" /> Поддержка
        </Link>
        <h1 className="mt-8 text-4xl font-extrabold tracking-tight md:text-5xl">Написать в поддержку</h1>
        <p className="mt-4 max-w-[60ch] text-[15px] leading-relaxed text-muted-foreground">
          Опишите проблему — в прототипе обращение станет локальным тикетом с номером. Если не видна статья,
          обязательно приложите ссылку на неё.
        </p>
      </div>

      <form onSubmit={submit} noValidate className="mt-10 space-y-5">
        <p className="meta"><span className="text-destructive" aria-hidden="true">*</span> — обязательное поле</p>
        <div>
          <label htmlFor="sp-category" className="meta">Категория <span className="text-destructive" aria-hidden="true">*</span><span className="sr-only"> (обязательно)</span></label>
          <select
            id="sp-category" required aria-required="true"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className={`${field} cursor-pointer font-mono text-sm`}
          >
            {categories.map((c) => (
              <option key={c.key} value={c.key}>{c.label}</option>
            ))}
          </select>
        </div>
        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <label htmlFor="sp-email" className="meta">Email для ответа <span className="text-destructive" aria-hidden="true">*</span><span className="sr-only"> (обязательно)</span></label>
            <input
              id="sp-email" required aria-required="true" aria-invalid={!!errors.email} aria-describedby={errors.email ? "sp-email-err" : undefined}
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className={field}
            />
            {errors.email && <p id="sp-email-err" className="mt-2 text-sm text-destructive">{errors.email}</p>}
          </div>
          <div>
            <label htmlFor="sp-handle" className="meta">Handle <span className="text-muted-foreground">(необязательно)</span></label>
            <input
              id="sp-handle"
              value={handle}
              onChange={(e) => setHandle(e.target.value)}
              placeholder="you.bsky.social"
              className={`${field} font-mono text-sm`}
            />
          </div>
        </div>
        {isCountryChange && (
          <fieldset className="space-y-5 rounded-md border border-border bg-secondary/40 p-5">
            <legend className="meta px-1">Смена страны резидентства · <Link to="/legal/register-and-residency" className="text-accent hover:underline">чем отличается от регистрации</Link></legend>
            <div className="grid gap-5 sm:grid-cols-2">
              <div>
                <label htmlFor="sp-country-from" className="meta">Текущая страна</label>
                <select
                  id="sp-country-from"
                  value={countryFrom}
                  onChange={(e) => setCountryFrom(e.target.value)}
                  className={`${field} cursor-pointer font-mono text-sm`}
                >
                  {COUNTRIES.map((c) => (
                    <option key={c} value={c}>{countryLabel(c)}</option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="sp-country-to" className="meta">Новая страна <span className="text-destructive" aria-hidden="true">*</span><span className="sr-only"> (обязательно)</span></label>
                <select
                  id="sp-country-to" required aria-required="true" aria-invalid={!!errors.countryTo} aria-describedby={errors.countryTo ? 'sp-country-to-err' : undefined}
                  value={countryTo}
                  onChange={(e) => setCountryTo(e.target.value)}
                  className={`${field} cursor-pointer font-mono text-sm`}
                >
                  <option value="">Выберите…</option>
                  {COUNTRIES.map((c) => (
                    <option key={c} value={c}>{countryLabel(c)}</option>
                  ))}
                </select>
                {errors.countryTo && <p id="sp-country-to-err" className="mt-2 text-sm text-destructive">{errors.countryTo}</p>}
              </div>
            </div>
            <div>
              <label htmlFor="sp-doc-type" className="meta">Тип документа <span className="text-destructive" aria-hidden="true">*</span></label>
              <select
                id="sp-doc-type"
                value={docType}
                onChange={(e) => setDocType(e.target.value as typeof docType)}
                className={`${field} cursor-pointer font-mono text-sm`}
              >
                {DOC_TYPES.map((d) => (
                  <option key={d.key} value={d.key}>{d.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="sp-doc-file" className="meta">Подтверждающий документ <span className="text-destructive" aria-hidden="true">*</span><span className="sr-only"> (обязательно)</span></label>
              <input
                id="sp-doc-file" required aria-required="true" aria-invalid={!!errors.docFile} aria-describedby={errors.docFile ? 'sp-doc-file-err' : 'sp-doc-file-hint'}
                type="file"
                accept="application/pdf,image/jpeg,image/png"
                onChange={(e) => {
                  onDocFile(e.target.files?.[0] ?? null)
                }}
                className={`${field} cursor-pointer font-mono text-sm file:mr-3 file:rounded file:border-0 file:bg-secondary file:px-3 file:py-1`}
              />
              {docFile && (
                <p className="meta mt-2 !normal-case tracking-normal">
                  <FileCheck size={11} className="mr-1 inline text-accent" aria-hidden="true" />
                  {docFile.name} · {(docFile.size / 1024 / 1024).toFixed(2)} МБ · {docFile.type}
                </p>
              )}
              <p id="sp-doc-file-hint" className="meta mt-2 !normal-case tracking-normal text-muted-foreground">
                PDF, JPG или PNG до 10 МБ. Документ используется только для проверки смены страны. В прототипе
                сохраняются лишь имя и размер файла — содержимое никуда не уходит; в боевой версии потребуется
                защищённая загрузка (secure upload).
              </p>
              {errors.docFile && <p id="sp-doc-file-err" className="mt-2 text-sm text-destructive">{errors.docFile}</p>}
            </div>
          </fieldset>
        )}
        {!isCountryChange && (
          <div>
            <label htmlFor="sp-article" className="meta">
              Ссылка на статью{category === 'not-visible' ? (<> <span className="text-destructive" aria-hidden="true">*</span><span className="sr-only"> (обязательно)</span></>) : ' · необязательно'}
            </label>
            <input
              id="sp-article" required={category === 'not-visible'} aria-required={category === 'not-visible'} aria-invalid={!!errors.articleUrl} aria-describedby={errors.articleUrl ? 'sp-article-err' : undefined}
              value={articleUrl}
              onChange={(e) => setArticleUrl(e.target.value)}
              placeholder="/article/a1 или https://…"
              className={`${field} font-mono text-sm`}
            />
            {errors.articleUrl && <p id="sp-article-err" className="mt-2 text-sm text-destructive">{errors.articleUrl}</p>}
          </div>
        )}
        {!isCountryChange && (
        <div>
          <label htmlFor="sp-subject" className="meta">Тема <span className="text-destructive" aria-hidden="true">*</span><span className="sr-only"> (обязательно)</span></label>
          <input
            id="sp-subject" required aria-required="true" aria-invalid={!!errors.subject} aria-describedby={errors.subject ? "sp-subject-err" : undefined}
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            className={field}
          />
          {errors.subject && <p id="sp-subject-err" className="mt-2 text-sm text-destructive">{errors.subject}</p>}
        </div>
        )}
        <div>
          <label htmlFor="sp-message" className="meta">
            {isCountryChange ? 'Причина смены' : 'Сообщение'} <span className="text-destructive" aria-hidden="true">*</span><span className="sr-only"> (обязательно)</span>
          </label>
          <textarea
            id="sp-message" required aria-required="true" aria-invalid={!!errors.message} aria-describedby={errors.message ? "sp-message-err" : undefined}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={6}
            className={`${field} resize-y`}
            placeholder={isCountryChange ? 'Почему меняется страна регистрации (переезд, резидентство…)' : 'Что произошло, что ожидали, шаги воспроизведения'}
          />
          {errors.message && <p id="sp-message-err" className="mt-2 text-sm text-destructive">{errors.message}</p>}
        </div>
        {isCountryChange && (
          <p className="meta !normal-case tracking-normal text-muted-foreground">
            страна профиля не меняется автоматически — заявка уходит на ручную проверку документов
          </p>
        )}
        <button type="submit" className="btn-primary">Зарегистрировать обращение</button>
      </form>
    </div>
  )
}
