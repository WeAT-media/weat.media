import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router'
import { Hourglass, ShieldCheck } from 'lucide-react'
import { SITE_NAME } from '@/config/site'
import { staffAuthConfigured, staffLogin, staffToken } from '@/lib/staffAuth'
import { plainExcerpt } from '@/lib/plainText'
import { remoteId } from '@/lib/remoteFeed'

/**
 * Очередь охлаждения (роль moderator): статьи и комментарии, которые ещё не ушли в AT, включая отложенные
 * до выхода. Модератор может только поставить метку коллегии — она подписана сервисом коллегии по тому же
 * at:// адресу и продолжит действовать после ухода записи в сеть. Править и удалять чужую запись нельзя.
 */

interface Item {
  uri: string
  did: string
  handle: string
  collection: string
  record: { title?: string; text?: string; subject?: { uri?: string } }
  visibleAt: string
  pendingUntil?: string
  status: string
  error: string | null
}
interface LabelerInfo { id: string; name: string; labels: { value: string; description: string }[] }

const field = 'rounded-md border border-input bg-background px-2 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
const when = (iso?: string) => (iso ? new Date(iso).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—')

function LabelForm({ uri, labelers, token, onDone }: { uri: string; labelers: LabelerInfo[]; token: string; onDone: (m: string) => void }) {
  const [labeler, setLabeler] = useState(labelers[0]?.id ?? '')
  const current = labelers.find((l) => l.id === labeler)
  const [val, setVal] = useState(current?.labels[0]?.value ?? '')
  const [note, setNote] = useState('')
  const send = async () => {
    const res = await fetch('/api/admin/labels', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ labeler, val, uri, neg: false, ...(note.trim() ? { note: `охлаждение: ${note.trim()}` } : { note: 'охлаждение' }) }),
    })
    const d = await res.json().catch(() => ({}))
    onDone(res.ok ? `Метка ${val} поставлена` : (d.message ?? `Ошибка ${res.status}`))
  }
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <select
        value={labeler}
        onChange={(e) => {
          setLabeler(e.target.value)
          setVal(labelers.find((l) => l.id === e.target.value)?.labels[0]?.value ?? '')
        }}
        aria-label="Коллегия"
        className={field}
      >
        {labelers.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
      </select>
      <select value={val} onChange={(e) => setVal(e.target.value)} aria-label="Метка" className={field}>
        {current?.labels.map((v) => <option key={v.value} value={v.value}>{v.description}</option>)}
      </select>
      <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="основание (в журнал)" aria-label="Основание" className={`${field} min-w-0 flex-1`} />
      <button type="button" onClick={() => void send()} disabled={!val} className="btn-primary !px-3 !py-1.5 !text-[11px]">Поставить метку</button>
    </div>
  )
}

export default function AdminCooldownPage() {
  const token = staffToken()
  const [items, setItems] = useState<Item[]>([])
  const [labelers, setLabelers] = useState<LabelerInfo[]>([])
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const load = useCallback(() => {
    fetch('/api/admin/cooldown', { headers: { authorization: `Bearer ${token}` } })
      .then(async (r) => {
        const d = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(d.message ?? `Ошибка ${r.status}`)
        setItems(d.items)
      })
      .catch((e: Error) => setError(e.message))
  }, [token])
  useEffect(() => {
    if (!token) return
    load()
    fetch('/api/labelers').then((r) => r.json()).then((d: { labelers?: LabelerInfo[] }) => setLabelers(d.labelers ?? []), () => {})
  }, [token, load])

  if (!token) {
    return (
      <div className="mx-auto max-w-[520px] px-5 py-20">
        <h1 className="text-3xl font-extrabold tracking-tight">Охлаждение</h1>
        {staffAuthConfigured ? (
          <button type="button" onClick={() => void staffLogin('/admin/cooldown')} className="btn-primary mt-6 w-full !py-2.5">
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
          <p className="meta">Админка · модерация</p>
          <h1 className="mt-2 text-4xl font-extrabold tracking-tight">Охлаждение</h1>
          <p className="mt-2 max-w-[66ch] text-sm text-muted-foreground">
            Записи, которые ещё не ушли в AT (24 ч после выхода на сайте). Можно только поставить метку коллегии — она
            останется и после ухода в сеть. Править и удалять запись может лишь автор.
          </p>
        </div>
        <span className="flex gap-2">
          <button type="button" onClick={load} className="btn-ghost !px-3 !py-2 !text-[11px]">Обновить</button>
          <Link to="/admin/labels" className="btn-ghost !px-3 !py-2 !text-[11px]">Метки</Link>
        </span>
      </div>

      {error && <p role="alert" className="mt-4 text-sm text-destructive">{error}</p>}
      {notice && <p role="status" className="mt-4 text-sm">{notice}</p>}

      <ul className="mt-6 space-y-3">
        {items.length === 0 && !error && <li className="text-sm text-muted-foreground">Очередь пуста.</li>}
        {items.map((i) => {
          const article = i.collection === 'media.weat.article'
          const scheduled = new Date(i.visibleAt) > new Date()
          return (
            <li key={i.uri} className="border border-border p-4">
              <p className="meta inline-flex flex-wrap items-center gap-1.5">
                <Hourglass size={11} aria-hidden="true" /> {article ? 'статья' : 'комментарий'} · @{i.handle} ·{' '}
                {scheduled ? `выйдет на сайте ${when(i.visibleAt)}` : `на сайте с ${when(i.visibleAt)}`} · в AT {when(i.pendingUntil)}
                {i.status === 'failed' && <span className="text-destructive"> · не ушла: {i.error}</span>}
              </p>
              {article ? (
                <Link to={`/article/${remoteId(i.uri)}`} className="mt-1 block font-semibold hover:text-accent">{i.record.title || 'Без заголовка'}</Link>
              ) : (
                i.record.subject?.uri && <Link to={`/article/${remoteId(i.record.subject.uri)}`} className="meta mt-1 block hover:text-accent">к статье</Link>
              )}
              <p className="mt-1 line-clamp-3 text-sm text-muted-foreground">{plainExcerpt(i.record.text ?? '', 400)}</p>
              <p className="meta mt-1 break-all !normal-case tracking-normal">{i.uri}</p>
              {labelers.length > 0 && <LabelForm uri={i.uri} labelers={labelers} token={token} onDone={setNotice} />}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
