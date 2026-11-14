import { useEffect, useState } from 'react'
import { Play, Save, Trash2 } from 'lucide-react'
import ArticleBlock from '@/components/ArticleBlock'
import { markdownToBlocks } from '@/lib/remoteFeed'

/**
 * Правила разбора сайтов для краулера — как Telegram Instant View: XPath-правила на хост,
 * проверка на живой странице и сохранение. Синтаксис — services/crawler/src/rules.ts.
 */

type Call = <T>(path: string, init?: RequestInit) => Promise<T>

interface SiteRules { host: string; rules: string; updated_at: string }
interface Preview {
  host: string
  matched: boolean
  error: string | null
  article: { title: string; author: string | null; cover: string | null; publishedAt: string | null; excerpt: string; markdown: string; tags: string[] } | null
}

const EXAMPLE = `~version: "2.0"

?path: /blog/.+

title: //header/h1[1]
cover: //header/img[1]
body:  //article[has-class("prose")]
@remove: //div[has-class("ads")]`

const field = 'w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

export default function SiteRulesEditor({ call }: { call: Call }) {
  const [list, setList] = useState<SiteRules[]>([])
  const [host, setHost] = useState('')
  const [rules, setRules] = useState(EXAMPLE)
  const [url, setUrl] = useState('')
  const [preview, setPreview] = useState<Preview | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  const load = () => call<SiteRules[]>('/rules').then(setList, () => {})
  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const pick = (r: SiteRules) => {
    setHost(r.host)
    setRules(r.rules)
    setPreview(null)
    setMessage('')
  }

  const run = async (fn: () => Promise<void>) => {
    setBusy(true)
    setMessage('')
    try {
      await fn()
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Не удалось')
    } finally {
      setBusy(false)
    }
  }

  const check = () =>
    run(async () => {
      const p = await call<Preview>('/rules/preview', { method: 'POST', body: JSON.stringify({ url, rules }) })
      setPreview(p)
      if (!host && p.host) setHost(p.host)
    })

  const save = () =>
    run(async () => {
      const h = host.trim().toLowerCase().replace(/^www\./, '') || (url ? new URL(url).hostname.replace(/^www\./, '') : '')
      if (!h) throw new Error('Укажите хост сайта')
      await call(`/rules/${encodeURIComponent(h)}`, { method: 'PUT', body: JSON.stringify({ rules }) })
      setHost(h)
      setMessage(`Сохранено для ${h}: следующие статьи этого сайта краулер разберёт по правилам`)
      await load()
    })

  const remove = () =>
    run(async () => {
      await call(`/rules/${encodeURIComponent(host)}`, { method: 'DELETE' })
      setMessage(`Правила ${host} удалены — снова встроенный разбор`)
      setHost('')
      setRules(EXAMPLE)
      await load()
    })

  return (
    <section aria-label="Правила разбора сайтов" className="mt-8 border border-border p-5">
      <h2 className="font-mono text-[13px] font-bold uppercase tracking-[0.12em]">Правила разбора сайтов</h2>
      <p className="mt-2 max-w-[70ch] text-sm text-muted-foreground">
        Как{' '}
        <a href="https://instantview.telegram.org/docs" target="_blank" rel="noopener noreferrer" className="text-accent underline underline-offset-4">
          Telegram Instant View
        </a>
        : XPath-правила для сайта. Свойства <code>title</code>, <code>subtitle</code>, <code>author</code>, <code>author_url</code>,{' '}
        <code>published_date</code>, <code>cover</code>, <code>body</code>, <code>description</code>, <code>tags</code>; условия <code>?path</code>,{' '}
        <code>?domain</code>, <code>?exists</code>, <code>?not_exists</code>; <code>@remove</code>, <code>!свойство</code>, <code>has-class()</code>.
      </p>

      {list.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {list.map((r) => (
            <button key={r.host} type="button" onClick={() => pick(r)} className={`rounded-md border px-2.5 py-1 font-mono text-xs ${host === r.host ? 'border-accent text-accent' : 'border-border'}`}>
              {r.host}
            </button>
          ))}
        </div>
      )}

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div className="grid gap-2">
          <input value={host} onChange={(e) => setHost(e.target.value)} placeholder="хост: blog.example.com" aria-label="Хост сайта" className={`${field} font-mono`} />
          <textarea value={rules} onChange={(e) => setRules(e.target.value)} rows={14} spellCheck={false} aria-label="Правила" className={`${field} font-mono text-[13px]`} />
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="адрес статьи для проверки" aria-label="Адрес статьи" className={field} />
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={busy || !url} onClick={() => void check()} className="btn-ghost !px-3 !py-2 !text-[12px]">
              <Play size={13} aria-hidden="true" /> Проверить
            </button>
            <button type="button" disabled={busy} onClick={() => void save()} className="btn-primary !px-3 !py-2 !text-[12px]">
              <Save size={13} aria-hidden="true" /> Сохранить
            </button>
            {list.some((r) => r.host === host) && (
              <button type="button" disabled={busy} onClick={() => void remove()} className="btn-ghost !px-3 !py-2 !text-[12px]">
                <Trash2 size={13} aria-hidden="true" /> Удалить
              </button>
            )}
          </div>
          {message && <p className="text-sm">{message}</p>}
        </div>

        <div className="border border-dashed border-border p-4">
          {!preview ? (
            <p className="text-sm text-muted-foreground">Вставьте адрес статьи и нажмите «Проверить» — здесь будет то, что извлечёт краулер.</p>
          ) : preview.error ? (
            <p role="alert" className="text-sm text-destructive">{preview.error}</p>
          ) : preview.article ? (
            <article>
              <p className="meta">
                {preview.host}
                {preview.article.author && ` · ${preview.article.author}`}
                {preview.article.publishedAt && ` · ${new Date(preview.article.publishedAt).toLocaleDateString('ru-RU')}`}
              </p>
              <h3 className="mt-2 text-xl font-extrabold tracking-tight">{preview.article.title}</h3>
              {preview.article.cover && <img src={preview.article.cover} alt="" className="mt-3 max-h-48 w-full object-cover" />}
              <div className="mt-3 max-h-[420px] overflow-auto text-sm">
                {markdownToBlocks(preview.article.markdown.slice(0, 6000)).map((b, i) => (
                  <ArticleBlock key={i} block={b} />
                ))}
              </div>
            </article>
          ) : null}
        </div>
      </div>
    </section>
  )
}
