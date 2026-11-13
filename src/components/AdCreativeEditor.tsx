import { useState, type FormEvent } from 'react'
import { ImagePlus, Trash2 } from 'lucide-react'
import { AdView } from '@/components/AdBanner'
import { AD_IMAGE_MAX_BYTES, loadAds, readImageFile, safeAdImageSrc, saveAds, type AdCreative } from '@/lib/ads'
import { safeHref } from '@/lib/safeUrl'

const inputCls =
  'w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

const newErid = () => `2Vtz${Math.random().toString(36).slice(2, 9).toUpperCase()}`

/** Креативы: текст, ссылка, картинка или GIF; предпросмотр — тот же баннер, что увидят читатели */
export default function AdCreativeEditor() {
  const [ads, setAds] = useState<AdCreative[]>(loadAds)
  const [draft, setDraft] = useState<AdCreative>(() => ads[0]!)
  const [imageUrl, setImageUrl] = useState('')
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)

  const set = (p: Partial<AdCreative>) => {
    setDraft((d) => ({ ...d, ...p }))
    setSaved(false)
  }

  const pickFile = async (file: File | undefined) => {
    if (!file) return
    setError('')
    try {
      const img = await readImageFile(file)
      set({ image: { ...img, alt: draft.image?.alt ?? '' } })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось загрузить картинку')
    }
  }

  const useUrl = () => {
    const src = imageUrl.trim()
    if (!safeAdImageSrc(src)) return setError('Ссылка на картинку — только https://')
    setError('')
    set({ image: { src, alt: draft.image?.alt ?? '', animated: /\.gif(\?|$)/i.test(src) } })
  }

  const save = (e: FormEvent) => {
    e.preventDefault()
    if (!safeHref(draft.url) || !/^https?:/.test(draft.url)) return setError('Ссылка объявления — https://…')
    if (draft.image && !draft.image.alt.trim()) return setError('Опишите картинку (альтернативный текст)')
    if (!draft.advertiser.trim()) return setError('Укажите рекламодателя — это обязательная часть маркировки')
    setError('')
    // показывается один креатив: активный выключает остальные
    const next = ads.some((a) => a.id === draft.id) ? ads.map((a) => (a.id === draft.id ? draft : a)) : [draft, ...ads]
    const list = draft.active ? next.map((a) => ({ ...a, active: a.id === draft.id })) : next
    setAds(list)
    saveAds(list)
    setSaved(true)
  }

  const create = () => {
    setDraft({ id: `ad-${Date.now()}`, erid: newErid(), advertiser: draft.advertiser, title: '', text: '', url: 'https://', cta: 'Перейти', active: true })
    setImageUrl('')
    setSaved(false)
  }

  return (
    <section className="mt-10 border border-border p-6" aria-labelledby="creative-h">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="creative-h" className="text-xl font-extrabold tracking-tight">Креатив</h2>
        <div className="flex flex-wrap gap-2">
          {ads.map((a) => (
            <button key={a.id} type="button" onClick={() => { setDraft(a); setSaved(false) }} className={`btn-ghost !px-3 !py-1.5 !text-[11px] ${a.id === draft.id ? '!border-accent !text-accent' : ''}`}>
              {a.title || 'без названия'}{a.active ? ' · показ' : ''}
            </button>
          ))}
          <button type="button" onClick={create} className="btn-ghost !px-3 !py-1.5 !text-[11px]">+ Новый</button>
        </div>
      </div>

      <div className="mt-6 grid gap-8 lg:grid-cols-2">
        <form onSubmit={save} className="grid gap-3">
          <label className="grid gap-1 text-sm font-semibold">Рекламодатель
            <input className={inputCls} value={draft.advertiser} onChange={(e) => set({ advertiser: e.target.value })} placeholder="ООО «Ромашка», ИНН 7700000000" maxLength={120} required />
          </label>
          <label className="grid gap-1 text-sm font-semibold">Заголовок
            <input className={inputCls} value={draft.title} onChange={(e) => set({ title: e.target.value })} maxLength={90} required />
          </label>
          <label className="grid gap-1 text-sm font-semibold">Текст
            <textarea className={inputCls} rows={2} value={draft.text} onChange={(e) => set({ text: e.target.value })} maxLength={220} />
          </label>
          <div className="grid gap-3 sm:grid-cols-[1fr_140px]">
            <label className="grid gap-1 text-sm font-semibold">Ссылка
              <input className={inputCls} type="url" value={draft.url} onChange={(e) => set({ url: e.target.value })} required />
            </label>
            <label className="grid gap-1 text-sm font-semibold">Кнопка
              <input className={inputCls} value={draft.cta} onChange={(e) => set({ cta: e.target.value })} maxLength={24} />
            </label>
          </div>

          <fieldset className="grid gap-2 rounded-md border border-border p-3">
            <legend className="px-1 text-sm font-semibold">Картинка или GIF — по желанию</legend>
            <label className="btn-ghost w-fit cursor-pointer !px-3 !py-1.5 !text-[11px]">
              <ImagePlus size={13} aria-hidden="true" /> Загрузить файл
              <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="sr-only" onChange={(e) => void pickFile(e.target.files?.[0])} />
            </label>
            <div className="flex gap-2">
              <input className={inputCls} value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} placeholder="или https://…/banner.gif" />
              <button type="button" onClick={useUrl} className="btn-ghost shrink-0 !px-3 !py-1.5 !text-[11px]">Взять</button>
            </div>
            <p className="meta !normal-case tracking-normal">PNG, JPEG, WebP или GIF до {AD_IMAGE_MAX_BYTES / 1024 / 1024} МБ · соотношение 4:3</p>
            {draft.image && (
              <>
                <label className="grid gap-1 text-sm font-semibold">Что на картинке (для незрячих и при отключённых картинках)
                  <input className={inputCls} value={draft.image.alt} onChange={(e) => set({ image: { ...draft.image!, alt: e.target.value } })} maxLength={150} required />
                </label>
                <button type="button" onClick={() => set({ image: undefined })} className="btn-ghost w-fit !px-3 !py-1.5 !text-[11px]">
                  <Trash2 size={12} aria-hidden="true" /> Убрать картинку
                </button>
              </>
            )}
          </fieldset>

          <label className="flex w-fit items-center gap-2 text-sm">
            <input type="checkbox" className="h-4 w-4 shrink-0" checked={draft.active} onChange={(e) => set({ active: e.target.checked })} />
            Показывать в статьях
          </label>
          <p className="meta !normal-case tracking-normal">erid: {draft.erid}</p>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <div className="flex items-center gap-3">
            <button type="submit" className="btn-primary">Сохранить</button>
            {saved && <span role="status" className="meta text-accent">сохранено</span>}
          </div>
        </form>

        <div>
          <p className="meta">Предпросмотр — так увидят читатели</p>
          <AdView key={`${draft.id}-${draft.image?.src.length ?? 0}`} ad={draft} />
        </div>
      </div>
    </section>
  )
}
