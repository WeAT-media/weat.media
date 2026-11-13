import { useCallback, useEffect, useState } from 'react'
import { useLocation, useSearchParams } from 'react-router'
import { CheckCircle2, KeyRound, Scale } from 'lucide-react'
import Reveal from '@/components/Reveal'
import ProviderIcon from '@/components/ProviderIcon'
import { api, ApiError, hasSession, PROVIDER_LABEL, type IdentitiesView, type Provider } from '@/lib/api'
import { authErrorText } from '@/lib/authErrors'
import { SITE_NAME } from '@/config/site'

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })

/** Связанные аккаунты: дополнительные способы входа в тот же профиль */
export default function LinkedAccountsSettingsPage() {
  const location = useLocation()
  const [searchParams, setSearchParams] = useSearchParams()
  const [view, setView] = useState<IdentitiesView | null>(null)
  const [loadError, setLoadError] = useState('')
  const [busy, setBusy] = useState<Provider | null>(null)
  const [actionError, setActionError] = useState('')
  const linked = searchParams.get('linked') as Provider | null
  const redirectError = authErrorText(searchParams.get('error'))
  const sessionActive = hasSession()

  const load = useCallback(() => {
    api.identities().then(
      (v) => {
        setView(v)
        setLoadError('')
      },
      (e) => setLoadError(e instanceof Error ? e.message : 'Не удалось загрузить'),
    )
  }, [])

  useEffect(() => {
    if (sessionActive) load()
  }, [sessionActive, load])

  const clearNotice = () => {
    if (searchParams.has('linked') || searchParams.has('error')) setSearchParams({}, { replace: true })
  }

  const [atHandle, setAtHandle] = useState('')
  const [atOpen, setAtOpen] = useState(false)

  const link = async (p: Provider) => {
    if (p === 'atproto' && !atOpen) {
      setAtOpen(true)
      return
    }
    if (p === 'atproto' && !atHandle.trim()) return
    clearNotice()
    setActionError('')
    setBusy(p)
    try {
      const url =
        p === 'atproto'
          ? (await api.linkAtproto(atHandle.trim(), location.pathname)).url
          : (await api.linkOAuth(p, location.pathname)).url
      window.location.assign(url)
    } catch (e) {
      setActionError(e instanceof ApiError ? authErrorText(e.code) || e.message : 'Не удалось начать привязку')
      setBusy(null)
    }
  }

  const unlink = async (p: Provider) => {
    clearNotice()
    setActionError('')
    setBusy(p)
    try {
      setView(await api.unlink(p))
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Не удалось отвязать')
    } finally {
      setBusy(null)
    }
  }

  return (
    <Reveal className="border border-border p-6">
      <section aria-label="Связанные аккаунты">
        <h2 className="font-mono text-[13px] font-bold uppercase tracking-[0.12em]">Связанные аккаунты</h2>
        <p className="mt-2 max-w-[60ch] text-sm text-muted-foreground">
          Дополнительные способы входа в этот же профиль. Профиль, публикации и подписчики не меняются — меняется только
          то, чем вы подтверждаете, что это вы.
        </p>

        {!sessionActive && (
          <p className="mt-5 border border-dashed border-border p-4 text-sm">
            Это демо-аккаунт. Связанные аккаунты доступны после входа через аккаунт {SITE_NAME}.
          </p>
        )}

        {linked && (
          <p role="status" className="mt-5 flex items-center gap-2 border border-accent/60 bg-secondary/60 p-4 text-sm">
            <CheckCircle2 size={16} className="text-accent" aria-hidden="true" /> {PROVIDER_LABEL[linked] ?? linked} привязан.
            Теперь им можно входить.
          </p>
        )}
        {(redirectError || actionError || loadError) && (
          <p role="alert" className="mt-5 border border-destructive/60 bg-destructive/5 p-4 text-sm">
            {actionError || redirectError || loadError}
          </p>
        )}

        {view && (
          <ul className="mt-6 divide-y divide-border border-y border-border">
            <li className="flex flex-wrap items-center justify-between gap-3 py-4">
              <div className="flex items-center gap-3">
                <KeyRound size={18} aria-hidden="true" />
                <div>
                  <p className="text-sm font-semibold">Пароль</p>
                  <p className="meta mt-0.5 !normal-case tracking-normal">
                    {view.passwordLogin ? 'вход по handle или email и паролю' : 'не задан — вы входите через привязанный сервис'}
                  </p>
                </div>
              </div>
            </li>
            {view.providers.map((p) => (
              <li key={p.provider} className="flex flex-wrap items-center justify-between gap-3 py-4">
                <div className="flex min-w-0 items-center gap-3">
                  <ProviderIcon provider={p.provider} />
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                      {PROVIDER_LABEL[p.provider]}
                      {p.linked?.primary && (
                        <span className="rounded-full border border-border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.06em] text-muted-foreground">
                          основной
                        </span>
                      )}
                    </p>
                    <p className="meta mt-0.5 !normal-case tracking-normal">
                      {p.linked
                        ? `${p.linked.display ?? 'привязан'} · с ${fmtDate(p.linked.linkedAt)}`
                        : !p.configured
                          ? 'пока не подключён на сервере'
                          : 'не привязан'}
                      {!p.loginAllowed && p.configured && ' · вход через него недоступен для российских аккаунтов'}
                    </p>
                  </div>
                </div>
                {p.provider === 'atproto' && atOpen && !p.linked && (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault()
                      void link('atproto')
                    }}
                    className="flex w-full gap-2"
                  >
                    <input
                      autoFocus
                      value={atHandle}
                      onChange={(e) => setAtHandle(e.target.value)}
                      placeholder="alice.bsky.social"
                      aria-label="Handle на другом AT-сервере"
                      className="min-w-0 flex-1 rounded-md border border-input bg-background px-3 py-2 font-mono text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    />
                    <button type="submit" disabled={busy !== null} className="btn-primary !px-3.5 !py-2 !text-[11px]">
                      {busy === 'atproto' ? 'Переходим…' : 'Продолжить'}
                    </button>
                  </form>
                )}
                {p.provider === 'atproto' && atOpen && !p.linked ? null : p.linked ? (
                  <button
                    type="button"
                    onClick={() => unlink(p.provider)}
                    disabled={busy !== null}
                    className="btn-ghost !px-3.5 !py-2 !text-[11px] hover:!border-destructive hover:!text-destructive"
                  >
                    {busy === p.provider ? 'Отвязываем…' : 'Отвязать'}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => link(p.provider)}
                    disabled={busy !== null || !p.configured}
                    className="btn-ghost !px-3.5 !py-2 !text-[11px] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {busy === p.provider ? 'Переходим…' : 'Привязать'}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}

        {view?.providers.some((p) => !p.loginAllowed) && (
          <p className="mt-4 flex max-w-[64ch] gap-2 text-sm text-muted-foreground">
            <Scale size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
            По закону (149-ФЗ, ред. 406-ФЗ) российских пользователей можно авторизовать только через российские сервисы.
            Google, GitHub, Telegram и внешний AT-аккаунт можно привязать, но входить для аккаунтов, зарегистрированных в
            России, — паролем или через Яндекс ID.
          </p>
        )}
      </section>
    </Reveal>
  )
}
