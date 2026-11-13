import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router'
import { BadgeCheck, ExternalLink, ShieldCheck, X } from 'lucide-react'
import { SITE_NAME } from '@/config/site'
import { remoteId } from '@/lib/remoteFeed'
import { staffAuthConfigured, staffLogin, staffToken } from '@/lib/staffAuth'

/** Поддержка: заявки «я автор оригинала». Проверка — код из заявки виден в профиле автора на сайте */

interface Claim {
  id: string
  status: 'pending' | 'approved' | 'rejected' | 'transferred'
  sourceSite: string
  sourceAuthor: string | null
  sourceAuthorUrl: string | null
  articleUri: string
  code: string
  note: string | null
  decisionNote: string | null
  createdAt: string
  claimant: { did: string; handle?: string }
}

const TABS: { key: Claim['status']; label: string }[] = [
  { key: 'pending', label: 'На проверке' },
  { key: 'approved', label: 'Подтверждены' },
  { key: 'rejected', label: 'Отклонены' },
]

export default function AdminClaimsPage() {
  const token = staffToken()
  const [tab, setTab] = useState<Claim['status']>('pending')
  const [rows, setRows] = useState<Claim[]>([])
  const [error, setError] = useState('')
  const [reason, setReason] = useState<Record<string, string>>({})

  const call = useCallback(
    async <T,>(path: string, init: RequestInit = {}): Promise<T> => {
      const res = await fetch(`/api${path}`, { ...init, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` } })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.message ?? `Ошибка ${res.status}`)
      return data as T
    },
    [token],
  )
  const load = useCallback(() => {
    call<Claim[]>(`/admin/claims?status=${tab}`).then(setRows, (e) => setError(e.message))
  }, [call, tab])
  useEffect(() => {
    if (token) load()
  }, [token, load])

  const decide = async (id: string, action: 'approve' | 'reject') => {
    setError('')
    try {
      await call(`/admin/claims/${id}/${action}`, { method: 'POST', body: JSON.stringify({ note: reason[id] || undefined }) })
      load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось')
    }
  }

  if (!token) {
    return (
      <div className="mx-auto max-w-[520px] px-5 py-20">
        <h1 className="text-3xl font-extrabold tracking-tight">Заявки на авторство</h1>
        {staffAuthConfigured ? (
          <button type="button" onClick={() => void staffLogin('/admin/claims')} className="btn-primary mt-6 w-full !py-2.5">
            <ShieldCheck size={15} aria-hidden="true" /> Войти через {SITE_NAME}
          </button>
        ) : (
          <p className="mt-4 text-sm text-muted-foreground">Вход сотрудников не настроен (VITE_ZITADEL_*).</p>
        )}
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-[1100px] px-5 pb-24 md:px-8">
      <div className="flex flex-wrap items-end justify-between gap-4 pt-10">
        <div>
          <p className="meta">Админка · поддержка</p>
          <h1 className="mt-2 text-4xl font-extrabold tracking-tight">Заявки на авторство</h1>
          <p className="mt-2 max-w-[66ch] text-sm text-muted-foreground">
            Откройте профиль автора на сайте и найдите код заявки (обычно в «О себе»). Код на месте — подтверждайте; статьи этого
            автора перейдут заявителю.
          </p>
        </div>
        <Link to="/admin/crawler" className="btn-ghost !px-3 !py-2 !text-[11px]">Краулер</Link>
      </div>

      <div role="tablist" className="mt-6 flex gap-2">
        {TABS.map((t) => (
          <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)} className={`btn-ghost !px-3 !py-1.5 !text-[11px] ${tab === t.key ? '!border-accent !text-accent' : ''}`}>
            {t.label}
          </button>
        ))}
      </div>
      {error && <p role="alert" className="mt-4 border border-destructive/60 bg-destructive/5 p-3 text-sm">{error}</p>}

      {rows.length === 0 ? (
        <p className="mt-8 text-muted-foreground">Заявок нет.</p>
      ) : (
        <ul className="mt-6 divide-y divide-border border border-border">
          {rows.map((c) => (
            <li key={c.id} className="grid gap-3 p-5 md:grid-cols-[1fr_auto]">
              <div className="min-w-0">
                <p className="font-bold">
                  @{c.claimant.handle ?? c.claimant.did} → {c.sourceAuthor ? <>автор <b>{c.sourceAuthor}</b></> : 'одна статья'} на {c.sourceSite}
                </p>
                <p className="mt-1 flex flex-wrap items-center gap-3 text-sm">
                  <span>код: <code className="font-mono">{c.code}</code></span>
                  {c.sourceAuthorUrl && (
                    <a href={c.sourceAuthorUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-accent hover:underline">
                      профиль на сайте <ExternalLink size={11} aria-hidden="true" />
                    </a>
                  )}
                  <Link to={`/article/${remoteId(c.articleUri)}`} className="text-accent hover:underline">статья</Link>
                  <span className="meta">{new Date(c.createdAt).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' })}</span>
                </p>
                {c.note && <p className="mt-1 text-sm text-muted-foreground">Пояснение: {c.note}</p>}
                {c.decisionNote && <p className="mt-1 text-sm text-muted-foreground">Решение: {c.decisionNote}</p>}
              </div>
              {c.status === 'pending' && (
                <div className="flex flex-col gap-2 md:w-72">
                  <input
                    value={reason[c.id] ?? ''}
                    onChange={(e) => setReason((r) => ({ ...r, [c.id]: e.target.value }))}
                    placeholder="причина (для отказа обязательна)"
                    className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm"
                  />
                  <div className="flex gap-2">
                    <button type="button" onClick={() => void decide(c.id, 'approve')} className="btn-primary flex-1 !py-1.5 !text-[11px]">
                      <BadgeCheck size={12} aria-hidden="true" /> Подтвердить
                    </button>
                    <button type="button" onClick={() => void decide(c.id, 'reject')} className="btn-ghost flex-1 !py-1.5 !text-[11px]">
                      <X size={12} aria-hidden="true" /> Отклонить
                    </button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
