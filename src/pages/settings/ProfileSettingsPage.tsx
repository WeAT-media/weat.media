import { useEffect, useRef, useState, type FormEvent } from 'react'
import { ImagePlus, Trash2 } from 'lucide-react'
import Reveal from '@/components/Reveal'
import { useStore } from '@/lib/store'
import { api, avatarUrl, profile } from '@/lib/api'

/**
 * Имя, «О себе» и фото профиля. Всё хранится в записи app.bsky.actor.profile вашего репозитория —
 * поэтому видно и в Bluesky, и в других приложениях AT. То же доступно по API (PATCH /v1/me, POST /v1/me/avatar).
 */
export default function ProfileSettingsPage() {
  const { user } = useStore()
  const [name, setName] = useState('')
  const [about, setAbout] = useState('')
  const [avatar, setAvatar] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!user?.did) return
    void profile.get(user.did).then((p) => {
      setName(p.displayName ?? '')
      setAbout(p.description ?? '')
    })
    void api.user(user.did).then((u) => setAvatar(u.avatar ?? null), () => {})
  }, [user?.did])

  const run = async (fn: () => Promise<void>, ok: string) => {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await fn()
      setNotice(ok)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось сохранить')
    } finally {
      setBusy(false)
    }
  }

  const save = (e: FormEvent) => {
    e.preventDefault()
    void run(async () => {
      await profile.update({ displayName: name.trim() || null, description: about.trim() || null })
    }, 'Сохранено')
  }

  const upload = (file: File | undefined) => {
    if (!file) return
    if (file.size > 1_000_000) return setError('Фото больше 1 МБ — уменьшите его')
    void run(async () => {
      setAvatar((await profile.setAvatar(file)).avatar)
    }, 'Фото обновлено')
  }

  if (!user) return null
  const field = 'w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

  return (
    <Reveal className="border border-border bg-secondary/40 p-6">
      <section aria-label="Профиль">
        <h2 className="font-mono text-[13px] font-bold uppercase tracking-[0.12em]">Профиль</h2>
        <p className="mt-2 max-w-[60ch] text-sm text-muted-foreground">
          Имя, «О себе» и фото хранятся в вашем репозитории — их видят все приложения AT, включая Bluesky.
        </p>

        <div className="mt-6 flex flex-wrap items-center gap-4">
          {avatar ? (
            <img src={avatarUrl(user.did, avatar)} alt="Фото профиля" className="h-20 w-20 rounded-full border border-border object-cover" />
          ) : (
            <span className="flex h-20 w-20 items-center justify-center rounded-full bg-primary font-mono text-2xl font-bold text-primary-foreground" aria-hidden="true">
              {(name || user.handle).slice(0, 1)}
            </span>
          )}
          <div className="flex flex-wrap gap-2">
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => upload(e.target.files?.[0])} />
            <button type="button" disabled={busy} onClick={() => fileRef.current?.click()} className="btn-primary !px-3 !py-2 !text-[12px]">
              <ImagePlus size={14} aria-hidden="true" /> {avatar ? 'Сменить фото' : 'Загрузить фото'}
            </button>
            {avatar && (
              <button type="button" disabled={busy} onClick={() => void run(async () => setAvatar((await profile.removeAvatar()).avatar), 'Фото убрано')} className="btn-ghost !px-3 !py-2 !text-[12px]">
                <Trash2 size={14} aria-hidden="true" /> Убрать
              </button>
            )}
          </div>
          <p className="meta w-full !normal-case tracking-normal">PNG, JPEG или WebP, до 1 МБ</p>
        </div>

        <form onSubmit={save} className="mt-6 grid max-w-[560px] gap-3">
          <label className="grid gap-1 text-sm">
            Имя
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={64} placeholder={user.handle} className={field} />
          </label>
          <label className="grid gap-1 text-sm">
            О себе
            <textarea value={about} onChange={(e) => setAbout(e.target.value)} maxLength={256} rows={3} className={field} />
            <span className="meta !normal-case tracking-normal">{about.length}/256</span>
          </label>
          <button type="submit" disabled={busy} className="btn-primary !px-4 !py-2 sm:w-fit">
            {busy ? 'Сохраняем…' : 'Сохранить'}
          </button>
        </form>
        {notice && <p className="mt-3 text-sm text-accent">{notice}</p>}
        {error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}
      </section>
    </Reveal>
  )
}
