import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router'
import QRCode from 'qrcode'
import { CheckCircle2, Copy, Mail, ShieldCheck, Smartphone } from 'lucide-react'
import Reveal from '@/components/Reveal'
import { hasSession, security, type SecurityView } from '@/lib/api'
import { SITE_NAME } from '@/config/site'

const inputCls =
  'min-w-0 flex-1 rounded-md border border-input bg-background px-3 py-2 font-mono text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
const card = 'border-t border-border py-5 first:border-t-0 first:pt-0'

function Badge({ on, children }: { on: boolean; children: string }) {
  return (
    <span
      className={`rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.06em] ${
        on ? 'border-accent/60 text-accent' : 'border-border text-muted-foreground'
      }`}
    >
      {children}
    </span>
  )
}

/** Безопасность: подтверждение email, email-2FA (по умолчанию), приложение-аутентификатор, резервные коды */
export default function SecuritySettingsPage() {
  const [params] = useSearchParams()
  const welcome = params.get('welcome') === '1'
  const [view, setView] = useState<SecurityView | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)

  const [confirmCode, setConfirmCode] = useState('')
  const [disableEmailSent, setDisableEmailSent] = useState(false)
  const [emailOffCode, setEmailOffCode] = useState('')

  const [setup, setSetup] = useState<{ secret: string; qr: string } | null>(null)
  const [totpCode, setTotpCode] = useState('')
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null)
  const [totpOffCode, setTotpOffCode] = useState('')

  const sessionActive = hasSession()

  const load = useCallback(() => {
    security.get().then(setView, (e) => setError(e instanceof Error ? e.message : 'Не удалось загрузить'))
  }, [])
  useEffect(() => {
    if (sessionActive) load()
  }, [sessionActive, load])

  const act = async (fn: () => Promise<void>, e?: FormEvent) => {
    e?.preventDefault()
    setError('')
    setNotice('')
    setBusy(true)
    try {
      await fn()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось выполнить запрос')
    } finally {
      setBusy(false)
    }
  }

  if (!sessionActive) {
    return (
      <Reveal className="border border-border p-6">
        <p className="text-sm">Это демо-аккаунт. Настройки безопасности доступны после входа через аккаунт {SITE_NAME}.</p>
      </Reveal>
    )
  }

  return (
    <Reveal className="border border-border p-6">
      <section aria-label="Безопасность">
        <h2 className="font-mono text-[13px] font-bold uppercase tracking-[0.12em]">Безопасность</h2>

        {welcome && view && !view.emailConfirmed && (
          <p className="mt-4 border border-accent/60 bg-secondary/60 p-4 text-sm">
            Аккаунт создан. Подтвердите email ниже — это включит двухфакторную защиту и восстановление пароля по почте.
          </p>
        )}
        {notice && (
          <p role="status" className="mt-4 flex items-center gap-2 border border-accent/60 bg-secondary/60 p-4 text-sm">
            <CheckCircle2 size={16} className="text-accent" aria-hidden="true" /> {notice}
          </p>
        )}
        {error && <p role="alert" className="mt-4 border border-destructive/60 bg-destructive/5 p-4 text-sm">{error}</p>}

        {view && (
          <div className="mt-6">
            {/* Email */}
            <div className={card}>
              <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                <Mail size={16} aria-hidden="true" /> Email
                <Badge on={view.emailConfirmed}>{view.emailConfirmed ? 'подтверждён' : 'не подтверждён'}</Badge>
              </p>
              <p className="meta mt-1 !normal-case tracking-normal">{view.email ?? '—'}</p>
              {!view.emailConfirmed && (
                <form onSubmit={(e) => act(async () => (setView(await security.confirmEmail(confirmCode.trim())), setNotice('Email подтверждён. Двухфакторная защита по почте включена.')), e)} className="mt-3 flex flex-wrap gap-2">
                  <input value={confirmCode} onChange={(e) => setConfirmCode(e.target.value)} placeholder="код из письма" aria-label="Код подтверждения email" autoComplete="one-time-code" className={inputCls} />
                  <button type="submit" disabled={busy || !confirmCode.trim()} className="btn-primary !px-3.5 !py-2 !text-[11px]">Подтвердить</button>
                  <button type="button" disabled={busy} onClick={() => act(async () => (await security.requestEmailConfirmation(), setNotice('Отправили новый код.')))} className="btn-ghost !px-3.5 !py-2 !text-[11px]">
                    Прислать снова
                  </button>
                </form>
              )}
            </div>

            {/* Email-2FA */}
            <div className={card}>
              <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                <ShieldCheck size={16} aria-hidden="true" /> Код на почту при входе
                <Badge on={view.emailAuthFactor}>{view.emailAuthFactor ? 'включено' : 'выключено'}</Badge>
              </p>
              <p className="mt-1 max-w-[60ch] text-sm text-muted-foreground">
                {view.passwordLogin
                  ? 'При входе по паролю попросим код из письма. Включается автоматически после подтверждения email.'
                  : 'Вы входите через привязанный сервис — второй фактор обеспечивает он. Код на почту начнёт работать, когда вы зададите пароль.'}
              </p>
              {view.emailConfirmed && view.passwordLogin && (
                view.emailAuthFactor ? (
                  disableEmailSent ? (
                    <form onSubmit={(e) => act(async () => {
                      const r = await security.setEmail2fa(false, emailOffCode.trim())
                      if ('email' in r) setView(r)
                      setDisableEmailSent(false)
                      setNotice('Код на почту при входе выключен.')
                    }, e)} className="mt-3 flex flex-wrap gap-2">
                      <input value={emailOffCode} onChange={(e) => setEmailOffCode(e.target.value)} placeholder="код из письма" aria-label="Код для выключения" className={inputCls} />
                      <button type="submit" disabled={busy || !emailOffCode.trim()} className="btn-ghost !px-3.5 !py-2 !text-[11px] hover:!border-destructive hover:!text-destructive">Выключить</button>
                    </form>
                  ) : (
                    <button type="button" disabled={busy} onClick={() => act(async () => (await security.setEmail2fa(false), setDisableEmailSent(true), setNotice('Чтобы выключить защиту, введите код из письма.')))} className="btn-ghost mt-3 !px-3.5 !py-2 !text-[11px]">
                      Выключить…
                    </button>
                  )
                ) : (
                  <button type="button" disabled={busy} onClick={() => act(async () => {
                    const r = await security.setEmail2fa(true)
                    if ('email' in r) setView(r)
                    setNotice('Код на почту при входе включён.')
                  })} className="btn-primary mt-3 !px-3.5 !py-2 !text-[11px]">
                    Включить
                  </button>
                )
              )}
            </div>

            {/* TOTP */}
            <div className={card}>
              <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                <Smartphone size={16} aria-hidden="true" /> Приложение-аутентификатор
                <Badge on={view.totpEnabled}>{view.totpEnabled ? 'подключено' : 'не подключено'}</Badge>
              </p>
              <p className="mt-1 max-w-[60ch] text-sm text-muted-foreground">
                Яндекс Ключ, Google Authenticator и другие. Код спрашиваем при любом способе входа — по паролю и через
                привязанные сервисы.
                {view.totpEnabled && ` Резервных кодов осталось: ${view.backupCodesLeft}.`}
              </p>

              {!view.totpEnabled && !setup && (
                <button type="button" disabled={busy} onClick={() => act(async () => {
                  const s = await security.totpSetup()
                  setSetup({ secret: s.secret, qr: await QRCode.toDataURL(s.otpauthUrl, { margin: 1, width: 192 }) })
                })} className="btn-primary mt-3 !px-3.5 !py-2 !text-[11px]">
                  Подключить
                </button>
              )}

              {setup && (
                <div className="mt-4 flex flex-wrap items-start gap-5">
                  <img src={setup.qr} width={192} height={192} alt="QR-код для приложения-аутентификатора" className="rounded-md border border-border bg-white p-1" />
                  <div className="min-w-0 flex-1 space-y-3">
                    <p className="text-sm">1. Отсканируйте QR-код или введите ключ вручную:</p>
                    <p className="flex items-center gap-2">
                      <code className="break-all font-mono text-[12px]">{setup.secret.replace(/(.{4})/g, '$1 ').trim()}</code>
                      <button type="button" aria-label="Скопировать ключ" onClick={() => void navigator.clipboard?.writeText(setup.secret)} className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border hover:border-accent hover:text-accent">
                        <Copy size={12} aria-hidden="true" />
                      </button>
                    </p>
                    <form onSubmit={(e) => act(async () => {
                      const r = await security.totpEnable(totpCode.trim())
                      setView(r.security)
                      setBackupCodes(r.backupCodes)
                      setSetup(null)
                      setTotpCode('')
                      setNotice('Приложение подключено.')
                    }, e)} className="flex flex-wrap gap-2">
                      <span className="w-full text-sm">2. Введите 6 цифр из приложения:</span>
                      <input value={totpCode} onChange={(e) => setTotpCode(e.target.value)} inputMode="numeric" placeholder="123456" aria-label="Код из приложения" autoComplete="one-time-code" className={inputCls} />
                      <button type="submit" disabled={busy || totpCode.trim().length < 6} className="btn-primary !px-3.5 !py-2 !text-[11px]">Готово</button>
                    </form>
                  </div>
                </div>
              )}

              {backupCodes && (
                <div className="mt-4 border border-accent/60 bg-secondary/60 p-4">
                  <p className="text-sm font-semibold">Резервные коды — сохраните их сейчас</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Каждый код срабатывает один раз, если телефона нет под рукой. Больше мы их не покажем.
                  </p>
                  <ul className="mt-3 grid grid-cols-2 gap-1 font-mono text-[13px] sm:grid-cols-5">
                    {backupCodes.map((c) => <li key={c}>{c}</li>)}
                  </ul>
                  <div className="mt-3 flex gap-2">
                    <button type="button" onClick={() => void navigator.clipboard?.writeText(backupCodes.join('\n'))} className="btn-ghost !px-3.5 !py-2 !text-[11px]">Скопировать</button>
                    <button type="button" onClick={() => setBackupCodes(null)} className="btn-ghost !px-3.5 !py-2 !text-[11px]">Я сохранил</button>
                  </div>
                </div>
              )}

              {view.totpEnabled && !backupCodes && (
                <form onSubmit={(e) => e.preventDefault()} className="mt-3 flex flex-wrap gap-2">
                  <input value={totpOffCode} onChange={(e) => setTotpOffCode(e.target.value)} placeholder="код из приложения" aria-label="Код из приложения для изменений" autoComplete="one-time-code" className={inputCls} />
                  <button type="button" disabled={busy || !totpOffCode.trim()} onClick={() => act(async () => {
                    const r = await security.regenerateBackupCodes(totpOffCode.trim())
                    setBackupCodes(r.backupCodes)
                    setTotpOffCode('')
                    load()
                  })} className="btn-ghost !px-3.5 !py-2 !text-[11px]">
                    Новые резервные коды
                  </button>
                  <button type="button" disabled={busy || !totpOffCode.trim()} onClick={() => act(async () => {
                    setView(await security.totpDisable(totpOffCode.trim()))
                    setTotpOffCode('')
                    setNotice('Приложение-аутентификатор отключено.')
                  })} className="btn-ghost !px-3.5 !py-2 !text-[11px] hover:!border-destructive hover:!text-destructive">
                    Отключить
                  </button>
                </form>
              )}
            </div>

            {/* Восстановление */}
            <div className={card}>
              <p className="text-sm font-semibold">Восстановление доступа</p>
              <p className="mt-1 max-w-[60ch] text-sm text-muted-foreground">
                Забыли пароль — смените его по коду из письма на{' '}
                <Link to="/login/reset" className="text-accent underline-offset-4 hover:underline">странице восстановления</Link>.
                {!view.emailConfirmed && ' Работает только с подтверждённым email.'}
              </p>
            </div>
          </div>
        )}
      </section>
    </Reveal>
  )
}
