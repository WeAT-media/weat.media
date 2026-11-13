import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router'
import { Monitor } from 'lucide-react'
import { countryLabel } from '@/lib/api'

export interface DeviceSession {
  id: string
  device: string
  country: string
  createdAt: string
  lastSeenAt: string
  revokedAt: string | null
  current?: boolean
}

const when = (iso: string) => new Date(iso).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

/**
 * Журнал устройств — один список для пользователя («Безопасность») и сотрудника (/admin/users).
 * revokeAll — для пользователя «все, кроме этого», для сотрудника — все.
 */
export default function DevicesList({
  load,
  revoke,
  revokeAll,
  revokeAllLabel,
  self,
}: {
  load: () => Promise<DeviceSession[]>
  revoke: (id: string) => Promise<unknown>
  revokeAll: () => Promise<unknown>
  revokeAllLabel: string
  /** свой список: подсказка про смену пароля и метка «это устройство» */
  self?: boolean
}) {
  const [rows, setRows] = useState<DeviceSession[] | null>(null)
  const [error, setError] = useState('')
  const reload = useCallback(() => load().then(setRows, (e) => setError(e instanceof Error ? e.message : 'Не удалось загрузить')), [load])
  useEffect(() => {
    void reload()
  }, [reload])

  const act = async (fn: () => Promise<unknown>) => {
    setError('')
    try {
      await fn()
      await reload()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось')
    }
  }

  const active = rows?.filter((r) => !r.revokedAt) ?? []
  const others = active.filter((r) => !r.current)

  return (
    <div>
      {error && <p role="alert" className="mt-2 text-sm text-destructive">{error}</p>}
      {rows === null ? (
        <p className="meta mt-3">Загружаем…</p>
      ) : rows.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">Сессий нет.</p>
      ) : (
        <ul className="mt-3">
          {rows.map((s) => (
            <li key={s.id} className={`flex flex-wrap items-center justify-between gap-3 border-b border-border/70 py-2.5 text-sm last:border-b-0 ${s.revokedAt ? 'opacity-55' : ''}`}>
              <span className="inline-flex min-w-0 items-center gap-2">
                <Monitor size={14} className="shrink-0 text-muted-foreground" aria-hidden="true" />
                <span>
                  <b>{s.device}</b>
                  {s.current && <span className="ml-2 rounded-full border border-accent/60 px-2 py-0.5 font-mono text-[10px] text-accent">это устройство</span>}
                  <span className="meta block !normal-case tracking-normal">
                    {countryLabel(s.country)} · вход {when(s.createdAt)} · активность {when(s.lastSeenAt)}
                    {s.revokedAt && ` · завершена ${when(s.revokedAt)}`}
                  </span>
                </span>
              </span>
              {!s.revokedAt && !s.current && (
                <button type="button" onClick={() => void act(() => revoke(s.id))} className="btn-ghost !px-3 !py-1 !text-[11px] hover:!border-destructive hover:!text-destructive">
                  Завершить
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {(self ? others.length : active.length) > 0 && (
        <button type="button" onClick={() => void act(revokeAll)} className="btn-ghost mt-3 !px-3 !py-1.5 !text-[11px]">
          {revokeAllLabel}
        </button>
      )}
      {self && (
        <p className="meta mt-3 !normal-case tracking-normal">
          Завершённая сессия больше не проходит через сайт. Если подозреваете взлом — ещё и{' '}
          <Link to="/login/reset" className="text-accent hover:underline">смените пароль</Link>: это обрывает все входы сразу.
        </p>
      )}
    </div>
  )
}
