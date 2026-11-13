import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { staffCallback } from '@/lib/staffAuth'

/** Возврат из Zitadel: обмен кода на токены и переход туда, где начинали вход */
export default function AuthCallbackPage() {
  const navigate = useNavigate()
  const [error, setError] = useState('')
  const started = useRef(false)

  useEffect(() => {
    if (started.current) return
    started.current = true
    staffCallback(new URL(window.location.href)).then(
      (to) => navigate(to, { replace: true }),
      (err) => setError(err instanceof Error ? err.message : 'Не удалось завершить вход'),
    )
  }, [navigate])

  return (
    <div className="mx-auto max-w-[520px] px-5 py-24 text-center" role="status" aria-live="polite">
      {error ? (
        <>
          <h1 className="text-2xl font-extrabold tracking-tight">Вход не завершён</h1>
          <p className="mt-3 text-muted-foreground">{error}</p>
          <Link to="/admin/crawler" className="btn-ghost mt-6">Попробовать снова</Link>
        </>
      ) : (
        <p className="text-muted-foreground">Завершаем вход…</p>
      )}
    </div>
  )
}
