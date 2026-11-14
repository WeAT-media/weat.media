import { plainExcerpt } from '@/lib/plainText'
import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { PenLine, Plus, Trash2 } from 'lucide-react'
import Reveal from '@/components/Reveal'
import { drafts as draftsApi, type DraftSummary } from '@/lib/api'
import { useStore } from '@/lib/store'

/** Черновики статей: редактор сохраняет их сам, пока вы пишете; видите только вы, с любого устройства */
export default function DraftsSettingsPage() {
  const { user } = useStore()
  const [list, setList] = useState<DraftSummary[] | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    draftsApi.list().then((r) => setList(r.drafts), (e: Error) => setError(e.message))
  }, [])

  const remove = async (d: DraftSummary) => {
    if (!window.confirm(`Удалить черновик «${d.title || 'Без заголовка'}»?`)) return
    try {
      await draftsApi.remove(d.id)
      setList((l) => l?.filter((x) => x.id !== d.id) ?? null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось удалить')
    }
  }

  return (
    <Reveal className="border border-border bg-secondary/40 p-6">
      <section aria-label="Черновики">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-mono text-[13px] font-bold uppercase tracking-[0.12em]">Черновики</h2>
          <Link to="/compose" className="btn-primary !px-3 !py-2 !text-[12px]">
            <Plus size={13} aria-hidden="true" /> Новая статья
          </Link>
        </div>
        <p className="mt-2 max-w-[60ch] text-sm text-muted-foreground">
          Редактор сохраняет черновик сам, пока вы пишете. Черновики видите только вы, в публичный репозиторий они не
          попадают до публикации.{' '}
          {user && (
            <Link to={`/profile/${user.handle}/settings/import`} className="text-accent underline underline-offset-4">
              Импортированные посты
            </Link>
          )}{' '}
          — отдельно.
        </p>
        {error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}
        {list === null ? (
          <p className="mt-5 text-sm text-muted-foreground">Загружаем…</p>
        ) : list.length === 0 ? (
          <p className="mt-5 text-sm text-muted-foreground">Черновиков нет.</p>
        ) : (
          <ul className="mt-4">
            {list.map((d) => (
              <li key={d.id} className="flex flex-wrap items-start justify-between gap-3 border-b border-border/70 py-3 last:border-b-0">
                <div className="min-w-0 flex-1">
                  <Link to={`/compose?draft=${encodeURIComponent(d.id)}`} className="font-semibold decoration-accent underline-offset-4 hover:text-accent hover:underline">
                    {d.title || 'Без заголовка'}
                  </Link>
                  {d.excerpt && <p className="mt-0.5 line-clamp-2 text-sm text-muted-foreground">{plainExcerpt(d.excerpt)}</p>}
                  <p className="meta mt-1">{new Date(d.updatedAt).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Link to={`/compose?draft=${encodeURIComponent(d.id)}`} className="btn-ghost !px-3 !py-1.5 !text-[11px]">
                    <PenLine size={12} aria-hidden="true" /> Продолжить
                  </Link>
                  <button type="button" onClick={() => void remove(d)} className="btn-ghost !px-3 !py-1.5 !text-[11px]">
                    <Trash2 size={12} aria-hidden="true" /> Удалить
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </Reveal>
  )
}
