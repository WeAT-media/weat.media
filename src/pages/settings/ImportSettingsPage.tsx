import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { useStore } from '@/lib/store'
import Reveal from '@/components/Reveal'
import ArticleBlock from '@/components/ArticleBlock'
import { imports, type ImportDraft } from '@/lib/api'
import { markdownToBlocks } from '@/lib/remoteFeed'
import { currentUser } from '@/data/mock'

/**
 * Импорт постов привязанного AT-аккаунта: каждый пост — черновик.
 * Автор смотрит его здесь и выпускает как есть, открывает в редакторе или отклоняет.
 */
export default function ImportSettingsPage() {
  const { publishArticle, user } = useStore()
  const navigate = useNavigate()
  const [drafts, setDrafts] = useState<ImportDraft[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [open, setOpen] = useState<string | null>(null)

  const load = () =>
    imports
      .list('pending')
      .then((r) => setDrafts(r.drafts))
      .catch((e: Error) => setError(e.message))

  useEffect(() => {
    load()
  }, [])

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key)
    setError('')
    try {
      await fn()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не получилось. Попробуйте ещё раз.')
    } finally {
      setBusy(null)
    }
  }

  const fetchPosts = () =>
    run('import', async () => {
      const r = await imports.fromAtproto()
      setMessage(
        r.added
          ? `Добавлено черновиков: ${r.added}${r.complete ? '' : ' — постов больше 1000, повторите импорт для следующих'}`
          : 'Новых постов нет',
      )
      await load()
    })

  const publish = (d: ImportDraft) =>
    run(d.id, async () => {
      const text = d.text
      const blocks = markdownToBlocks(text)
      const uri = await publishArticle(
        {
          id: `u-${Date.now()}`,
          title: d.title,
          author: user ? { name: user.name, handle: user.handle, did: user.did } : currentUser,
          publishedAt: new Date().toISOString().slice(0, 10),
          language: 'ru',
          tags: [],
          readingTime: Math.max(1, Math.round(text.split(/\s+/).filter(Boolean).length / 180)),
          verdict: 'clear',
          excerpt: text.split(/\n{2,}/)[0]?.slice(0, 180) ?? '',
          blocks,
          comments: [],
          kind: 'text',
          source: { url: bskyUrl(d.sourceUri), label: 'AT Protocol' },
        },
        text,
      )
      await imports.setStatus(d.id, 'published', uri)
      setDrafts((prev) => prev?.filter((x) => x.id !== d.id) ?? null)
    })

  const dismiss = (d: ImportDraft) =>
    run(d.id, async () => {
      await imports.setStatus(d.id, 'dismissed')
      setDrafts((prev) => prev?.filter((x) => x.id !== d.id) ?? null)
    })

  return (
    <Reveal className="border border-border bg-secondary/40 p-6">
      <section aria-label="Импорт из AT Protocol">
        <h2 className="font-mono text-[13px] font-bold uppercase tracking-[0.12em]">Импорт из AT Protocol</h2>
        <div className="mt-5 flex flex-wrap items-center justify-between gap-4 border-b border-border/70 pb-5">
          <p className="max-w-[56ch] text-sm text-muted-foreground">
            Посты привязанного AT-аккаунта (bsky.social, свой PDS) станут черновиками. Ничего не публикуется само: просмотрите
            каждый и выпустите как есть или отредактируйте. Ответы в чужих ветках не переносятся.
          </p>
          <button type="button" onClick={fetchPosts} disabled={busy !== null} className="btn-primary shrink-0 !px-4 !py-2.5">
            {busy === 'import' ? 'Читаем посты…' : 'Импортировать посты'}
          </button>
        </div>
        {message && <p className="pt-4 text-sm">{message}</p>}
        {error && (
          <p role="alert" className="pt-4 text-sm text-destructive">
            {error}
            {/привяжите/i.test(error) && user && (
              <>
                {' '}
                <Link to={`/profile/${user.handle}/settings/accounts`} className="underline underline-offset-2">
                  Связанные аккаунты
                </Link>
              </>
            )}
          </p>
        )}

        {drafts === null ? (
          <p className="pt-6 text-sm text-muted-foreground">Загружаем черновики…</p>
        ) : drafts.length === 0 ? (
          <p className="pt-6 text-sm text-muted-foreground">Черновиков из импорта нет.</p>
        ) : (
          <ul className="mt-2">
            {drafts.map((d) => (
              <li key={d.id} className="border-b border-border/70 py-4 last:border-b-0">
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <button
                    type="button"
                    onClick={() => setOpen(open === d.id ? null : d.id)}
                    aria-expanded={open === d.id}
                    className="min-w-0 text-left font-semibold decoration-accent underline-offset-4 hover:text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {d.title}
                  </button>
                  <span className="meta shrink-0">
                    <a href={bskyUrl(d.sourceUri)} target="_blank" rel="noreferrer" className="hover:text-accent">
                      оригинал
                    </a>{' '}
                    · {new Date(d.sourceCreatedAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </span>
                </div>
                {open === d.id && (
                  <div className="mt-3 border border-border bg-background p-4">
                    {markdownToBlocks(d.text).map((b, i) => (
                      <ArticleBlock key={i} block={b} />
                    ))}
                  </div>
                )}
                <div className="mt-3 flex flex-wrap gap-2">
                  <button type="button" disabled={busy !== null} onClick={() => publish(d)} className="btn-primary !px-3 !py-1.5 !text-[11px]">
                    {busy === d.id ? '…' : 'Опубликовать'}
                  </button>
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => navigate(`/compose?import=${encodeURIComponent(d.id)}`)}
                    className="btn-ghost !px-3 !py-1.5 !text-[11px]"
                  >
                    Редактировать
                  </button>
                  <button type="button" disabled={busy !== null} onClick={() => dismiss(d)} className="btn-ghost !px-3 !py-1.5 !text-[11px]">
                    Отклонить
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

/** at://did/app.bsky.feed.post/rkey → страница поста в Bluesky */
function bskyUrl(uri: string): string {
  const m = /^at:\/\/([^/]+)\/app\.bsky\.feed\.post\/([^/]+)$/.exec(uri)
  return m ? `https://bsky.app/profile/${m[1]}/post/${m[2]}` : uri
}
