import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { api } from '@/lib/api'
import { useStore } from '@/lib/store'

export default function OAuthContinuePage() {
  const { user } = useStore()
  const [params] = useSearchParams()
  const clientId = params.get('client_id') ?? ''
  const requestUri = params.get('request_uri') ?? ''
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState('')
  const started = useRef(false)
  const returnTo = `/oauth/continue?${params}`

  useEffect(() => {
    if (!starting || started.current) return
    started.current = true
    api.oauthContinue({ client_id: clientId, request_uri: requestUri }).then(
      ({ url }) => window.location.assign(url),
      (e) => {
        setStarting(false)
        started.current = false
        setError(e instanceof Error ? e.message : 'Не удалось продолжить вход')
      },
    )
  }, [starting, clientId, requestUri])

  return (
    <div className="mx-auto max-w-[560px] px-5 py-24 text-center">
      <p className="meta">AT Protocol · OAuth</p>
      <h1 className="mt-4 text-3xl font-extrabold tracking-tight">Возвращаем в приложение</h1>
      {error && <p role="alert" className="mt-5 border border-destructive/60 bg-destructive/5 p-4 text-sm">{error}</p>}
      {starting ? (
        <p className="mt-4 text-muted-foreground" role="status">Подтверждаем вход и возвращаем вас в AT-приложение…</p>
      ) : (
        <>
          <p className="mt-4 text-muted-foreground">Продолжить как <strong className="text-foreground">@{user?.handle}</strong>?</p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <button className="btn-primary" onClick={() => { setError(''); setStarting(true) }}>Продолжить</button>
            <Link to={`/login?${new URLSearchParams({ returnTo })}`} className="btn-ghost">Сменить аккаунт</Link>
          </div>
        </>
      )}
    </div>
  )
}
