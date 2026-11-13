import { useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { ArrowLeft, CheckCircle2, KeyRound } from 'lucide-react'
import { security } from '@/lib/api'

const inputCls =
  'w-full rounded-md border border-input bg-background px-4 py-2.5 font-mono text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50'

/** Восстановление доступа: код на почту -> новый пароль (штатный сброс PDS) */
export default function PasswordResetPage() {
  const [stage, setStage] = useState<'email' | 'code' | 'done'>('email')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')

  const run = async (e: FormEvent, fn: () => Promise<void>) => {
    e.preventDefault()
    setError('')
    setPending(true)
    try {
      await fn()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось выполнить запрос')
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="mx-auto max-w-[560px] px-5 pb-24 md:px-8">
      <div className="pt-10">
        <Link
          to="/login"
          className="inline-flex items-center gap-2 font-mono text-[12px] font-semibold uppercase tracking-[0.08em] text-muted-foreground transition-colors hover:text-accent"
        >
          <ArrowLeft size={13} aria-hidden="true" /> Вход
        </Link>
        <p className="meta mt-8 flex items-center gap-1.5">
          <KeyRound size={12} aria-hidden="true" /> Восстановление доступа
        </p>
        <h1 className="mt-2 text-3xl font-extrabold tracking-tight md:text-4xl">Новый пароль</h1>
      </div>

      <div className="mt-8 rounded-md border border-border bg-background px-5 py-5">
        {stage === 'email' && (
          <form onSubmit={(e) => run(e, async () => (await security.forgotPassword(email.trim()), setStage('code')))}>
            <p className="text-sm text-muted-foreground">
              Укажите email аккаунта — пришлём код для смены пароля.
            </p>
            <fieldset disabled={pending} className="mt-4 space-y-2">
              <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email" aria-label="Email" autoComplete="email" className={inputCls} />
              <button type="submit" className="btn-primary w-full !py-2.5">{pending ? 'Отправляем…' : 'Прислать код'}</button>
            </fieldset>
          </form>
        )}

        {stage === 'code' && (
          <form onSubmit={(e) => run(e, async () => (await security.resetPassword(code.trim(), password), setStage('done')))}>
            <p className="text-sm text-muted-foreground">
              Если аккаунт с адресом <span className="font-mono">{email}</span> существует, письмо с кодом уже в пути.
              Проверьте «Спам», если его нет пару минут.
            </p>
            <fieldset disabled={pending} className="mt-4 space-y-2">
              <input required value={code} onChange={(e) => setCode(e.target.value)} placeholder="код из письма" aria-label="Код из письма" autoComplete="one-time-code" className={inputCls} />
              <input type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="новый пароль, от 8 символов" aria-label="Новый пароль" autoComplete="new-password" className={inputCls} />
              <button type="submit" className="btn-primary w-full !py-2.5">{pending ? 'Сохраняем…' : 'Сменить пароль'}</button>
            </fieldset>
            <button type="button" onClick={() => setStage('email')} className="meta mt-3 underline underline-offset-2 hover:text-accent">
              ← другой email
            </button>
          </form>
        )}

        {stage === 'done' && (
          <div role="status">
            <p className="flex items-center gap-2 text-[15px] font-semibold">
              <CheckCircle2 size={17} className="text-accent" aria-hidden="true" /> Пароль изменён
            </p>
            <p className="mt-2 text-sm text-muted-foreground">Войдите с новым паролем. Привязанные сервисы продолжают работать.</p>
            <Link to="/login" className="btn-primary mt-4 !px-4 !py-2">Войти</Link>
          </div>
        )}

        {error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}
      </div>
    </div>
  )
}
