import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { ArrowLeft, AtSign, KeyRound, ShieldAlert, ShieldCheck } from 'lucide-react'
import { useStore } from '@/lib/store'
import { safeReturnTo } from '@/lib/safeUrl'
import { api, ApiError, atprotoStartUrl, countryLabel, oauthStartUrl, PROVIDER_LABEL, type GeoInfo, type LoginResult, type Provider } from '@/lib/api'
import { authErrorText } from '@/lib/authErrors'
import ProviderIcon from '@/components/ProviderIcon'
import Reveal from '@/components/Reveal'
import { HANDLE_DOMAIN, SITE_NAME, SITE_URL } from '@/config/site'

/** сюда кладётся mfaToken, если вход после редиректа требует TOTP */
export const MFA_PENDING_KEY = 'indie-media:mfa-pending'

export default function LoginPage() {
  const { login, user } = useStore()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const rawReturnTo = searchParams.get('returnTo')
  // возврат после входа; принимаем только локальные пути
  const returnTo = safeReturnTo(rawReturnTo)
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [identifier, setIdentifier] = useState('')
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  // 152-ФЗ: согласие на ПДн — отдельной отметкой, не заранее отмеченной; соглашение — своей
  const [pdConsent, setPdConsent] = useState(false)
  const [termsConsent, setTermsConsent] = useState(false)
  const [providerConsent, setProviderConsent] = useState(false)
  const [formError, setFormError] = useState('')
  const [pending, setPending] = useState(false)
  const [geo, setGeo] = useState<GeoInfo | null>(null)
  const oauthError = searchParams.get('error')
  const handoffCode = searchParams.get('handoff')
  const [handoffError, setHandoffError] = useState('')
  const handoffStarted = useRef(false)
  /** второй шаг входа: код из письма (email-2FA PDS) или из приложения (TOTP) */
  const [step, setStep] = useState<{ kind: 'email' } | { kind: 'totp'; mfaToken: string } | null>(() => {
    try {
      const t = sessionStorage.getItem(MFA_PENDING_KEY)
      sessionStorage.removeItem(MFA_PENDING_KEY)
      return t ? { kind: 'totp', mfaToken: t } : null
    } catch {
      return null
    }
  })
  const [code, setCode] = useState('')
  const [contourRedirect, setContourRedirect] = useState('')

  useEffect(() => {
    api.geo().then(setGeo, () => setGeo(null))
  }, [])

  const done = (r: LoginResult, after = returnTo) => {
    if (r.kind === 'totp') {
      setCode('')
      setStep({ kind: 'totp', mfaToken: r.mfaToken })
      return
    }
    login(r.user)
    navigate(after, { replace: true })
  }

  // возврат с Яндекс ID: одноразовый код -> сессия; ref защищает от двойного вызова в StrictMode
  useEffect(() => {
    if (!handoffCode || handoffStarted.current) return
    handoffStarted.current = true
    api.handoff(handoffCode).then(
      (r) => done(r),
      (err) => setHandoffError(err instanceof Error ? err.message : 'Не удалось войти'),
    )
    // done стабилен по смыслу; код handoff одноразовый — эффект должен сработать один раз
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handoffCode])

  // сервер уже отфильтровал провайдеров по контуру (149-ФЗ): в РФ-контуре только российские
  const loginProviders = geo?.providers ?? []
  const oauthMessage = handoffError || authErrorText(oauthError)

  const [atHandle, setAtHandle] = useState('')

  const startProvider = async (p: Provider) => {
    if (p === 'atproto') return
    window.location.assign(oauthStartUrl(p, returnTo, providerConsent))
  }

  // РФ-контур ограничивает только регистрацию; вход открыт из любой страны
  const contourBlocked = mode === 'register' && geo?.contour === 'ru' && !geo.allowed

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setFormError('')
    setPending(true)
    try {
      if (mode === 'login') {
        done(await api.login(identifier.trim(), password))
      } else {
        const u = await api.register({ username: username.trim(), email: email.trim(), password })
        login(u)
        // сразу подтверждение email: после него включится 2FA и восстановление по почте
        navigate(`/profile/${u.handle}/settings/security?welcome=1`, { replace: true })
      }
    } catch (err) {
      if (err instanceof ApiError && err.code === 'WrongContour' && typeof err.data.redirect === 'string') {
        setContourRedirect(err.data.redirect)
        setFormError(err.message)
        return
      }
      if (err instanceof ApiError && err.code === 'AuthFactorTokenRequired') {
        setCode('')
        setStep({ kind: 'email' })
        return
      }
      if (err instanceof ApiError && err.code === 'ContourRestricted') {
        setGeo((g) => (g ? { ...g, allowed: false } : { country: 'ZZ', contour: 'ru', allowed: false, providers: [] }))
      }
      setFormError(err instanceof Error ? err.message : 'Не удалось выполнить запрос')
    } finally {
      setPending(false)
    }
  }

  const submitCode = async (e: FormEvent) => {
    e.preventDefault()
    if (!step || !code.trim()) return
    setFormError('')
    setPending(true)
    try {
      done(step.kind === 'email' ? await api.login(identifier.trim(), password, code.trim()) : await api.mfa(step.mfaToken, code.trim()))
    } catch (err) {
      if (err instanceof ApiError && (err.code === 'InvalidMfaToken' || err.code === 'TooManyAttempts')) setStep(null)
      setFormError(err instanceof Error ? err.message : 'Не удалось проверить код')
    } finally {
      setPending(false)
    }
  }

  const inputCls =
    'w-full rounded-md border border-input bg-background px-4 py-2.5 font-mono text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50'

  return (
    <div className="mx-auto max-w-[1200px] px-5 pb-24 md:px-8">
      <div className="pt-10">
        <Link
          to="/feed"
          className="inline-flex items-center gap-2 font-mono text-[12px] font-semibold uppercase tracking-[0.08em] text-muted-foreground transition-colors hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ArrowLeft size={13} aria-hidden="true" /> Лента
        </Link>
        <p className="meta mt-8">Авторизация · portable identity</p>
        <h1 className="mt-2 text-4xl font-extrabold tracking-tight md:text-5xl">Вход в {SITE_NAME}</h1>
        {returnTo !== '/' && (
          <p className="meta mt-4 text-accent">после входа вернём вас на {returnTo}</p>
        )}
        <p className="mt-4 max-w-[64ch] text-[15px] leading-relaxed text-muted-foreground">
          Входите через AT Protocol или соцсети. Аккаунт привязан к вашему репозиторию: смените площадку —
          сохраните подписчиков, историю и подписки.
        </p>
      </div>

      <div className="mt-10 grid items-start gap-10 lg:grid-cols-2">
        <Reveal>
          <section aria-label="Способы входа" className="space-y-3">
            {user ? (
              <p className="border border-accent/60 bg-secondary/60 p-5 text-[15px]">
                Вы вошли как <span className="font-semibold">@{user.handle}</span>. Можете{' '}
                <Link to="/settings" className="font-semibold text-accent underline-offset-4 hover:underline">
                  настроить Premium и AI
                </Link>{' '}
                или вернуться к ленте.
              </p>
            ) : (
              <>
                {contourBlocked && (
                  <div role="alert" className="flex gap-3 border border-destructive/60 bg-destructive/5 p-5 text-[15px]">
                    <ShieldAlert size={18} className="mt-0.5 shrink-0 text-destructive" aria-hidden="true" />
                    <div>
                      <p className="font-semibold">Регистрация доступна только из России</p>
                      <p className="mt-1 text-muted-foreground">
                        Это РФ-контур {SITE_NAME}: новый аккаунт можно создать только с российского IP-адреса.
                        Похоже, вы подключены через VPN или находитесь за рубежом
                        {geo && geo.country !== 'ZZ' ? ` (${countryLabel(geo.country)})` : ''}. Отключите VPN и
                        обновите страницу. Если аккаунт уже есть — входите из любой страны.
                      </p>
                    </div>
                  </div>
                )}
                {step && (
                  <form onSubmit={submitCode} className="rounded-md border border-accent/60 bg-background px-5 py-4">
                    <p className="flex items-center gap-3 text-[15px] font-medium">
                      <ShieldCheck size={17} aria-hidden="true" /> Подтвердите вход
                    </p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {step.kind === 'email'
                        ? 'Мы отправили код на вашу почту. Он действует 10 минут.'
                        : 'Введите 6 цифр из приложения-аутентификатора или резервный код.'}
                    </p>
                    <fieldset disabled={pending} className="mt-3 space-y-2">
                      <input
                        autoFocus
                        value={code}
                        onChange={(e) => setCode(e.target.value)}
                        placeholder={step.kind === 'email' ? 'XXXXX-XXXXX' : '123456 или xxxx-xxxx'}
                        aria-label={step.kind === 'email' ? 'Код из письма' : 'Код из приложения'}
                        autoComplete="one-time-code"
                        inputMode={step.kind === 'totp' ? 'numeric' : undefined}
                        required
                        className={inputCls}
                      />
                      <button type="submit" className="btn-primary w-full !py-2.5">
                        {pending ? 'Проверяем…' : 'Подтвердить'}
                      </button>
                    </fieldset>
                    {formError && <p role="alert" className="mt-2 text-sm text-destructive">{formError}</p>}
                    <button
                      type="button"
                      onClick={() => {
                        setStep(null)
                        setFormError('')
                      }}
                      className="meta mt-3 underline underline-offset-2 hover:text-accent"
                    >
                      ← другой способ входа
                    </button>
                  </form>
                )}
                {/* AT Proto — аккаунт на PDS инсталляции через AppView */}
                {!step && <form
                  onSubmit={submit}
                  className="rounded-md border border-border bg-background px-5 py-4"
                >
                  <p className="flex items-center gap-3 text-[15px] font-medium">
                    <AtSign size={17} aria-hidden="true" /> Через AT Protocol
                  </p>
                  <div role="tablist" aria-label="Вход или регистрация" className="mt-3 flex gap-2">
                    {(['login', 'register'] as const).map((m) => (
                      <button
                        key={m}
                        type="button"
                        role="tab"
                        aria-selected={mode === m}
                        onClick={() => {
                          setMode(m)
                          setFormError('')
                        }}
                        className={`btn-ghost !px-3 !py-1.5 !text-[11px] ${mode === m ? '!border-accent !text-accent' : ''}`}
                      >
                        {m === 'login' ? 'Вход' : 'Регистрация'}
                      </button>
                    ))}
                  </div>
                  <fieldset disabled={contourBlocked || pending} className="mt-3 space-y-2">
                    {mode === 'login' ? (
                      <input
                        value={identifier}
                        onChange={(e) => setIdentifier(e.target.value)}
                        placeholder={`handle.${HANDLE_DOMAIN} или email`}
                        aria-label="Handle или email"
                        autoComplete="username"
                        required
                        className={inputCls}
                      />
                    ) : (
                      <>
                        <div className="flex items-center gap-2">
                          <input
                            value={username}
                            onChange={(e) => setUsername(e.target.value)}
                            placeholder="username"
                            aria-label="Username"
                            autoComplete="username"
                            pattern="[a-zA-Z0-9][a-zA-Z0-9\-]{2,29}"
                            title="3–30 символов: латиница, цифры, дефис"
                            required
                            className={inputCls}
                          />
                          <span className="meta shrink-0">.{HANDLE_DOMAIN}</span>
                        </div>
                        <input
                          type="email"
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          placeholder="email"
                          aria-label="Email"
                          autoComplete="email"
                          required
                          className={inputCls}
                        />
                      </>
                    )}
                    <input
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder={mode === 'register' ? 'пароль, от 8 символов' : 'пароль'}
                      aria-label="Пароль"
                      autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
                      minLength={mode === 'register' ? 8 : undefined}
                      required
                      className={inputCls}
                    />
                    {mode === 'register' && (
                      <div className="space-y-2 pt-1 text-sm">
                        <label className="flex items-start gap-2">
                          <input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0" checked={pdConsent} onChange={(e) => setPdConsent(e.target.checked)} required />
                          <span>
                            Даю{' '}
                            <Link to="/legal/consent" target="_blank" className="text-accent underline underline-offset-2">согласие на обработку персональных данных</Link>{' '}
                            на условиях{' '}
                            <Link to="/legal/personal" target="_blank" className="text-accent underline underline-offset-2">Политики</Link>
                          </span>
                        </label>
                        <label className="flex items-start gap-2">
                          <input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0" checked={termsConsent} onChange={(e) => setTermsConsent(e.target.checked)} required />
                          <span>
                            Принимаю{' '}
                            <Link to="/legal/terms" target="_blank" className="text-accent underline underline-offset-2">пользовательское соглашение</Link>
                          </span>
                        </label>
                      </div>
                    )}
                    <button type="submit" className="btn-primary w-full !py-2.5" disabled={mode === 'register' && !(pdConsent && termsConsent)}>
                      {pending ? 'Подождите…' : mode === 'login' ? 'Войти' : 'Создать аккаунт'}
                    </button>
                  </fieldset>
                  {formError && <p role="alert" className="mt-2 text-sm text-destructive">{formError}</p>}
                  {contourRedirect && (
                    <a href={contourRedirect} className="btn-primary mt-2 w-full !py-2.5">
                      Продолжить вход на {new URL(contourRedirect).host}
                    </a>
                  )}
                  {import.meta.env.DEV && mode === 'login' && (
                    <p className="meta mt-3 flex flex-wrap items-center gap-2 !normal-case tracking-normal">
                      демо (pnpm seed:demo, пароль demo12345):
                      {['user', 'premium'].map((u) => (
                        <button
                          key={u}
                          type="button"
                          onClick={() => {
                            setIdentifier(`${u}.${HANDLE_DOMAIN}`)
                            setPassword('demo12345')
                          }}
                          className="underline underline-offset-2 hover:text-accent"
                        >
                          {u}.{HANDLE_DOMAIN}
                        </button>
                      ))}
                    </p>
                  )}
                  {geo && geo.country !== 'ZZ' && !contourBlocked && mode === 'register' && (
                    <p className="meta mt-2">страна регистрации: {countryLabel(geo.country)}</p>
                  )}
                  {mode === 'login' && (
                    <Link to="/login/reset" className="meta mt-3 inline-block underline underline-offset-2 hover:text-accent">
                      Забыли пароль?
                    </Link>
                  )}
                </form>}
                {oauthMessage && (
                  <p role="alert" className="border border-destructive/60 bg-destructive/5 p-4 text-sm">
                    {oauthMessage}
                  </p>
                )}
                {loginProviders.includes('atproto') && (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault()
                      if (atHandle.trim()) window.location.assign(atprotoStartUrl(atHandle.trim(), returnTo, providerConsent))
                    }}
                    className="rounded-md border border-border bg-background px-5 py-4"
                  >
                    <p className="flex items-center gap-3 text-[15px] font-medium">
                      <ProviderIcon provider="atproto" /> Через другой AT-сервер
                    </p>
                    <p className="meta mt-1 !normal-case tracking-normal">
                      bsky.social или собственный PDS — войдёт в привязанный профиль {SITE_NAME} или создаст новый
                    </p>
                    <div className="mt-3 flex gap-2">
                      <input
                        value={atHandle}
                        onChange={(e) => setAtHandle(e.target.value)}
                        placeholder="alice.bsky.social"
                        aria-label="Handle на другом AT-сервере"
                        className={inputCls}
                      />
                      <button type="submit" className="btn-ghost shrink-0 !px-4 !py-2.5">Войти</button>
                    </div>
                  </form>
                )}
                {(loginProviders.includes('yandex') || loginProviders.includes('atproto')) && (
                  <label className={`flex items-start gap-2 rounded-md border px-4 py-3 text-sm ${oauthError === 'ConsentRequired' ? 'border-accent' : 'border-border'}`}>
                    <input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0" checked={providerConsent} onChange={(e) => setProviderConsent(e.target.checked)} />
                    <span>
                      Впервые через Яндекс ID или AT-сервер? Отметьте, чтобы создать аккаунт: даю{' '}
                      <Link to="/legal/consent" target="_blank" className="text-accent underline underline-offset-2">согласие на обработку персональных данных</Link>{' '}
                      и принимаю{' '}
                      <Link to="/legal/terms" target="_blank" className="text-accent underline underline-offset-2">соглашение</Link>.
                      <span className="block text-xs text-muted-foreground">Для входа в существующий аккаунт отметка не нужна.</span>
                    </span>
                  </label>
                )}
                {loginProviders.filter((p) => p !== 'atproto').map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => startProvider(p)}
                    className="flex w-full cursor-pointer items-center gap-3 rounded-md border border-border bg-background px-5 py-3.5 text-left text-[15px] font-medium transition-colors duration-200 hover:border-accent hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <ProviderIcon provider={p} />
                    Войти через {PROVIDER_LABEL[p]}
                  </button>
                ))}
              </>
            )}
            <p className="meta pt-2">
              {geo?.contour === 'ru'
                ? `аккаунт создаётся на PDS ${SITE_NAME} (handle *.${HANDLE_DOMAIN}); из внешних сервисов в РФ-контуре доступен только Яндекс ID`
                : `аккаунт создаётся на PDS ${SITE_NAME} (handle *.${HANDLE_DOMAIN}); Google, GitHub и Telegram входят только в привязанный аккаунт`}
            </p>
          </section>
        </Reveal>

        <Reveal>
          {/* Встраиваемый виджет входа */}
          <section aria-label="Виджет для встраивания" className="border border-border bg-secondary/40 p-6">
            <p className="meta inline-flex items-center gap-1.5">
              <KeyRound size={12} aria-hidden="true" /> Виджет для сторонних сайтов
            </p>
            <h2 className="mt-2 text-xl font-extrabold tracking-tight">«Login via {SITE_NAME}»</h2>
            <p className="mt-2 text-[15px] leading-relaxed text-muted-foreground">
              Любой сайт может встроить кнопку входа через {SITE_NAME} — одна строка скрипта, OAuth 2.1 с
              PKCE/DPoP, никаких паролей на стороне сайта:
            </p>
            <pre className="mt-4 overflow-x-auto rounded-md bg-primary p-4 text-[12px] leading-relaxed text-primary-foreground">
              <code>{`<script src="${SITE_URL}/widget.js"
        data-client="your-site.dev"></script>

<button data-indie-login
  onlogin="handleIndieSession">Войти через ${SITE_NAME}</button>`}</code>
            </pre>
            <p className="meta mt-3">scope: read:profile · идентичность возвращается как DID</p>
          </section>
        </Reveal>
      </div>
    </div>
  )
}
