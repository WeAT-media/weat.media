import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { api, ApiError, type TelegramAuthData } from '@/lib/api'
import { authErrorText } from '@/lib/authErrors'
import { useStore } from '@/lib/store'
import { MFA_PENDING_KEY } from '@/pages/LoginPage'

function readTgResult(hash: string): TelegramAuthData | null {
  const raw = new URLSearchParams(hash.replace(/^#/, '')).get('tgAuthResult')
  if (!raw) return null
  try {
    const b64 = raw.replace(/-/g, '+').replace(/_/g, '/')
    const bytes = Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0))
    return JSON.parse(new TextDecoder().decode(bytes)) as TelegramAuthData
  } catch {
    return null
  }
}

/** Возврат с oauth.telegram.org: данные виджета приходят во фрагменте URL */
export default function TelegramAuthPage() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const { login } = useStore()
  const [data] = useState(() => readTgResult(window.location.hash))
  const [error, setError] = useState(data ? '' : 'Telegram не вернул данные входа. Попробуйте ещё раз.')
  const started = useRef(false)
  const mode = params.get('mode') === 'link' ? 'link' : 'login'
  const rawReturnTo = params.get('returnTo') ?? ''
  const returnTo = rawReturnTo.startsWith('/') && !rawReturnTo.startsWith('//') ? rawReturnTo : '/feed'

  useEffect(() => {
    if (started.current || !data) return
    started.current = true
    const fail = (e: unknown) =>
      setError(e instanceof ApiError ? authErrorText(e.code) || e.message : 'Не удалось завершить вход через Telegram')
    if (mode === 'link') {
      api.linkTelegram(data).then(() => navigate(`${returnTo}?linked=telegram`, { replace: true }), fail)
    } else {
      api.telegramLogin(data).then((r) => {
        if (r.kind === 'totp') {
          // токен не кладём в URL: страница входа заберёт его из sessionStorage
          try {
            sessionStorage.setItem(MFA_PENDING_KEY, r.mfaToken)
          } catch {
            /* без sessionStorage второй шаг не передать */
          }
          navigate(`/login?${new URLSearchParams({ returnTo })}`, { replace: true })
          return
        }
        login(r.user)
        navigate(returnTo, { replace: true })
      }, fail)
    }
  }, [data, mode, returnTo, login, navigate])

  return (
    <div className="mx-auto max-w-[560px] px-5 py-24 text-center">
      <p className="meta">Telegram</p>
      {error ? (
        <>
          <p role="alert" className="mt-4 text-[15px]">{error}</p>
          <Link to={mode === 'link' ? returnTo : '/login'} className="btn-ghost mt-8">
            Назад
          </Link>
        </>
      ) : (
        <p role="status" className="mt-4 text-[15px] text-muted-foreground">
          {mode === 'link' ? 'Привязываем Telegram…' : 'Входим…'}
        </p>
      )}
    </div>
  )
}
