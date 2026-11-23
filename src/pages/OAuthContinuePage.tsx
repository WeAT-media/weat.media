import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { security, type SecurityView } from '@/lib/api'
import { useStore } from '@/lib/store'
import { PDS_URL } from '@/config/site'

export default function OAuthContinuePage() {
  const { user } = useStore()
  const [params] = useSearchParams()
  const [view, setView] = useState<SecurityView | null>(null)
  const [error, setError] = useState('')
  const returnTo = `/oauth/continue?${params}`
  const passwordParams = new URLSearchParams(params)
  passwordParams.set('password', '1')
  const passwordUrl = `${PDS_URL}/oauth/authorize?${passwordParams}`

  useEffect(() => {
    security.get().then(setView, (e) => setError(e instanceof Error ? e.message : 'Не удалось проверить способ входа'))
  }, [])

  return (
    <div className="mx-auto max-w-[560px] px-5 py-24">
      <p className="meta text-center">AT Protocol · OAuth</p>
      <h1 className="mt-4 text-center text-3xl font-extrabold tracking-tight">Вход в AT-приложение</h1>
      <p className="mt-5 text-[15px] leading-relaxed text-muted-foreground">
        Аккаунт: <strong className="text-foreground">@{user?.handle}</strong>. Штатный PDS разрешает вход в сторонние
        приложения только с основным паролем AT Protocol — пароли приложений и сессия соцсети для этого не подходят.
      </p>
      {error && <p role="alert" className="mt-5 border border-destructive/60 bg-destructive/5 p-4 text-sm">{error}</p>}
      {!error && !view && <p className="mt-5 text-sm text-muted-foreground" role="status">Проверяем способ входа…</p>}
      {view?.passwordLogin ? (
        <a href={passwordUrl} className="btn-primary mt-6 w-full">Продолжить с AT-паролем</a>
      ) : view && (
        <>
          <p className="mt-5 border border-accent/60 bg-secondary/50 p-4 text-sm leading-relaxed">
            У этого аккаунта ещё нет AT-пароля. Задайте его в настройках — вход через соцсеть продолжит работать.
            После этого вернитесь к авторизации приложения.
          </p>
          <Link to="/settings/security" className="btn-primary mt-6 w-full">Задать AT-пароль</Link>
        </>
      )}
      <div className="mt-4 text-center">
        <Link to={`/login?${new URLSearchParams({ returnTo })}`} className="meta text-accent underline-offset-4 hover:underline">Сменить аккаунт</Link>
      </div>
    </div>
  )
}
