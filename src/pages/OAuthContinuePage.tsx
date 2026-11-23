import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { api } from '@/lib/api'

export default function OAuthContinuePage() {
  const [params] = useSearchParams()
  const clientId = params.get('client_id') ?? ''
  const requestUri = params.get('request_uri') ?? ''
  const [error, setError] = useState('')
  const started = useRef(false)

  useEffect(() => {
    if (started.current) return
    started.current = true
    api.oauthContinue({ client_id: clientId, request_uri: requestUri }).then(
      ({ url }) => window.location.assign(url),
      (e) => setError(e instanceof Error ? e.message : 'Не удалось продолжить вход'),
    )
  }, [clientId, requestUri])

  return (
    <div className="mx-auto max-w-[560px] px-5 py-24 text-center">
      <p className="meta">AT Protocol · OAuth</p>
      <h1 className="mt-4 text-3xl font-extrabold tracking-tight">Возвращаем в приложение</h1>
      {error ? (
        <>
          <p role="alert" className="mt-5 border border-destructive/60 bg-destructive/5 p-4 text-sm">{error}</p>
          <Link to="/feed" className="btn-ghost mt-6">Перейти в ленту</Link>
        </>
      ) : (
        <p className="mt-4 text-muted-foreground" role="status">Подтверждаем вход и возвращаем вас в AT-приложение…</p>
      )}
    </div>
  )
}
