import { useEffect, useState } from 'react'
import { BookOpen, Check } from 'lucide-react'
import { ApiError, articles } from '@/lib/api'

/**
 * Автору: копия старой статьи в standard.site (site.standard.document). Только у статьи, уже записанной в PDS:
 * на охлаждении кнопки нет — копия появится сама при публикации, если стояла галочка.
 */
export default function StandardSiteMirrorButton({ atUri }: { atUri: string }) {
  const rkey = /\/media\.weat\.article\/([^/]+)$/.exec(atUri)?.[1]
  const [state, setState] = useState<{ inPds: boolean; eligible: boolean; mirrored: boolean } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!rkey) return
    let alive = true
    articles.standardSiteStatus(rkey).then(
      (s) => alive && setState(s),
      () => {},
    )
    return () => {
      alive = false
    }
  }, [rkey])

  if (!rkey || !state?.inPds || !state.eligible) return null
  if (state.mirrored) {
    return (
      <p className="meta inline-flex items-center gap-1.5">
        <Check size={12} aria-hidden="true" /> Есть в standard.site
      </p>
    )
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true)
          setError('')
          try {
            await articles.mirrorToStandardSite(rkey)
            setState({ ...state, mirrored: true })
          } catch (e) {
            setError(e instanceof ApiError ? e.message : 'Не удалось скопировать — попробуйте позже')
          } finally {
            setBusy(false)
          }
        }}
        className="btn-ghost !px-3 !py-1.5 !text-[11px]"
      >
        <BookOpen size={12} aria-hidden="true" /> {busy ? 'Копируем…' : 'Дублировать в standard.site'}
      </button>
      {error && <span role="alert" className="text-sm text-destructive">{error}</span>}
    </div>
  )
}
