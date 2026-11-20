import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { Bot, ExternalLink, FileText, KeyRound, LogOut, Pause, Play, RefreshCw, RotateCcw, Rss, Send, ShieldCheck } from 'lucide-react'
import { remoteId } from '@/lib/remoteFeed'
import { HANDLE_DOMAIN, SITE_NAME } from '@/config/site'
import { staffAuthConfigured, staffLogin, staffLogout, staffToken } from '@/lib/staffAuth'
import SiteRulesEditor from '@/components/SiteRulesEditor'
import StandardAllowPanel from '@/components/StandardAllowPanel'

/** Админка краулера (services/crawler). Вход сотрудника через Zitadel (роль admin); ADMIN_TOKEN — только аварийно */

interface Crawler {
  id: string
  handle: string
  did: string
  displayName: string
  site: string
  enabled: boolean
}
interface Item {
  id: string
  url: string
  crawler_id: string
  status: 'held' | 'queued' | 'running' | 'published' | 'failed' | 'skipped'
  origin: 'manual' | 'source'
  title: string | null
  at_uri: string | null
  error: string | null
  attempts: number
  delay_hours?: number
  notified_at?: string | null
  publish_after?: string | null
  created_at: string
}
interface Source {
  id: string
  crawler_id: string
  url: string
  interval_min: number
  enabled: boolean
  last_polled_at: string | null
  last_error: string | null
  delay_hours?: number
  max_age_hours?: number | null
  link_pattern?: string | null
}

const TOKEN_KEY = 'indie-media:crawler-admin-token'
const BASE = '/crawler-api'
const inputCls =
  'w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

const STATUS: Record<Item['status'], { label: string; cls: string }> = {
  held: { label: 'ждёт автора', cls: 'border-accent text-accent' },
  skipped: { label: 'не публикуем', cls: 'border-border text-muted-foreground' },
  queued: { label: 'в очереди', cls: 'border-border text-muted-foreground' },
  running: { label: 'загружается', cls: 'border-accent/60 text-accent' },
  published: { label: 'опубликовано', cls: 'border-accent bg-accent/10 text-accent' },
  failed: { label: 'ошибка', cls: 'border-destructive/60 text-destructive' },
}

const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' }) : '—')

export default function AdminCrawlerPage() {
  const [token, setToken] = useState(() => {
    const staff = staffToken()
    if (staff) return staff
    try {
      return sessionStorage.getItem(TOKEN_KEY) ?? ''
    } catch {
      return ''
    }
  })
  const [me, setMe] = useState<{ name: string | null; roles: string[] } | null>(null)
  useEffect(() => {
    if (!token) return
    fetch('/api/admin/me', { headers: { authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? r.json() : null))
      .then(setMe, () => setMe(null))
  }, [token])
  const [tokenInput, setTokenInput] = useState('')
  const [crawlers, setCrawlers] = useState<Crawler[]>([])
  const [items, setItems] = useState<Item[]>([])
  const [sources, setSources] = useState<Source[]>([])
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const [url, setUrl] = useState('')
  const [crawlerId, setCrawlerId] = useState('')
  const [newCrawler, setNewCrawler] = useState({ id: '', site: '', displayName: '' })
  const [newSource, setNewSource] = useState({ url: '', crawler: '', intervalMin: 30, delayHours: '0', maxAgeHours: '', linkPattern: '' })

  const call = useCallback(
    async <T,>(path: string, init: RequestInit = {}): Promise<T> => {
      const res = await fetch(`${BASE}${path}`, {
        ...init,
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, ...init.headers },
      })
      const data = await res.json().catch(() => ({}))
      if (res.status === 403) {
        setToken('')
        try {
          sessionStorage.removeItem(TOKEN_KEY)
        } catch {
          /* noop */
        }
      }
      if (!res.ok) throw new Error((data as { message?: string }).message ?? `Ошибка ${res.status}`)
      return data as T
    },
    [token],
  )

  const load = useCallback(async () => {
    try {
      const [c, i, s] = await Promise.all([call<Crawler[]>('/crawlers'), call<Item[]>('/items?limit=100'), call<Source[]>('/sources')])
      setCrawlers(c)
      setItems(i)
      setSources(s)
      setCrawlerId((cur) => cur || c[0]?.id || '')
      setNewSource((cur) => (cur.crawler ? cur : { ...cur, crawler: c[0]?.id ?? '' }))
      setError('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Краулер недоступен')
    }
  }, [call])

  useEffect(() => {
    if (!token) return
    // статусы задач меняются в фоне — сразу и затем раз в 5 с
    const first = window.setTimeout(() => void load(), 0)
    const t = window.setInterval(() => void load(), 5000)
    return () => {
      window.clearTimeout(first)
      window.clearInterval(t)
    }
  }, [token, load])

  const act = async (fn: () => Promise<string | void>, e?: FormEvent) => {
    e?.preventDefault()
    setError('')
    setNotice('')
    try {
      const msg = await fn()
      if (msg) setNotice(msg)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка')
    }
  }

  if (!token) {
    return (
      <div className="mx-auto max-w-[520px] px-5 py-20">
        <p className="meta inline-flex items-center gap-1.5"><KeyRound size={12} aria-hidden="true" /> Админка</p>
        <h1 className="mt-2 text-3xl font-extrabold tracking-tight">Краулер</h1>
        {staffAuthConfigured && (
          <button type="button" onClick={() => void staffLogin('/admin/crawler')} className="btn-primary mt-6 w-full !py-2.5">
            <ShieldCheck size={15} aria-hidden="true" /> Войти через {SITE_NAME}
          </button>
        )}
        {staffAuthConfigured && <p className="meta mt-2 !normal-case tracking-normal">нужна роль admin в проекте weat.media и второй фактор</p>}
        <details className={staffAuthConfigured ? 'mt-8' : 'mt-6'} open={!staffAuthConfigured}>
          <summary className="meta cursor-pointer !normal-case tracking-normal">Аварийный вход по ADMIN_TOKEN</summary>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            const t = tokenInput.trim()
            if (!t) return
            try {
              sessionStorage.setItem(TOKEN_KEY, t)
            } catch {
              /* только до закрытия вкладки */
            }
            setToken(t)
          }}
          className="mt-6 space-y-3"
        >
          <input type="password" value={tokenInput} onChange={(e) => setTokenInput(e.target.value)} placeholder="ADMIN_TOKEN краулера" aria-label="Admin-токен" className={inputCls} />
          <button type="submit" className="btn-primary w-full !py-2.5">Войти</button>
          <p className="meta !normal-case tracking-normal">токен хранится только в этой вкладке</p>
        </form>
        </details>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-[1100px] px-5 pb-24 md:px-8">
      <div className="flex flex-wrap items-end justify-between gap-4 pt-10">
        <div>
          <p className="meta inline-flex items-center gap-1.5"><Bot size={12} aria-hidden="true" /> Админка · краулер</p>
          <h1 className="mt-2 text-4xl font-extrabold tracking-tight">Краулер</h1>
          <p className="mt-2 max-w-[64ch] text-sm text-muted-foreground">
            Ссылка на статью → выбранный краулер загружает её и публикует в своём AT-репозитории с указанием источника.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {me && <span className="meta !normal-case tracking-normal">{me.name ?? 'сотрудник'} · {me.roles.join(', ')}</span>}
          <Link to="/admin/claims" className="btn-ghost !px-3 !py-2 !text-[11px]">Заявки на авторство</Link>
          <Link to="/admin/tickets" className="btn-ghost !px-3 !py-2 !text-[11px]">Обращения</Link>
          <button type="button" onClick={() => void load()} className="btn-ghost !px-3 !py-2 !text-[11px]">
            <RefreshCw size={12} aria-hidden="true" /> Обновить
          </button>
          {staffToken() && (
            <button type="button" onClick={() => void staffLogout()} className="btn-ghost !px-3 !py-2 !text-[11px]">
              <LogOut size={12} aria-hidden="true" /> Выйти
            </button>
          )}
        </div>
      </div>

      {notice && <p role="status" className="mt-6 border border-accent/60 bg-secondary/60 p-3 text-sm">{notice}</p>}
      {error && <p role="alert" className="mt-6 border border-destructive/60 bg-destructive/5 p-3 text-sm">{error}</p>}

      {/* Статья по ссылке */}
      <section aria-label="Добавить статью" className="mt-8 border border-accent/60 p-5">
        <h2 className="font-mono text-[13px] font-bold uppercase tracking-[0.12em]">Перенести статью</h2>
        <form
          onSubmit={(e) =>
            act(async () => {
              const r = await call<{ duplicate: boolean }>('/crawl', { method: 'POST', body: JSON.stringify({ url: url.trim(), crawler: crawlerId }) })
              setUrl('')
              return r.duplicate ? 'Эта статья уже есть — повторно не публикуем.' : 'Поставлено в очередь.'
            }, e)
          }
          className="mt-3 grid gap-2 sm:grid-cols-[1fr_220px_auto]"
        >
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://habr.com/ru/articles/…" aria-label="Ссылка на статью" required className={inputCls} />
          <select value={crawlerId} onChange={(e) => setCrawlerId(e.target.value)} aria-label="Краулер" className={inputCls}>
            {crawlers.map((c) => (
              <option key={c.id} value={c.id} disabled={!c.enabled}>{c.handle}</option>
            ))}
          </select>
          <button type="submit" disabled={!crawlerId} className="btn-primary !px-4 !py-2">
            <Send size={13} aria-hidden="true" /> В очередь
          </button>
        </form>
      </section>

      {/* Задачи */}
      <SiteRulesEditor call={call} />

      <section aria-label="Задачи" className="mt-8">
        <h2 className="font-mono text-[13px] font-bold uppercase tracking-[0.12em]">Задачи · {items.length}</h2>
        <ul className="mt-3 divide-y divide-border border-y border-border">
          {items.length === 0 && <li className="py-4 text-sm text-muted-foreground">Пока пусто</li>}
          {items.map((i) => (
            <li key={i.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{i.title ?? i.url}</p>
                <p className="meta mt-0.5 truncate !normal-case tracking-normal">
                  {i.origin === 'source' ? 'из RSS' : 'вручную'} · {i.crawler_id} · {fmt(i.created_at)} · попыток: {i.attempts}
                </p>
                {i.error && i.status !== 'published' && <p className="mt-1 text-[13px] text-destructive">{i.error}</p>}
                {i.status === 'queued' && i.publish_after && (
                  <p className="meta mt-0.5 !normal-case tracking-normal">автору написали {fmt(i.notified_at ?? null)} · публикация {fmt(i.publish_after)}</p>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className={`rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.06em] ${STATUS[i.status].cls}`}>
                  {STATUS[i.status].label}
                </span>
                {i.status === 'published' && i.at_uri && (
                  <Link to={`/article/${remoteId(i.at_uri)}`} aria-label={`На ${SITE_NAME}`} title={`Открыть на ${SITE_NAME}`} className="btn-ghost !px-2 !py-1.5">
                    <FileText size={12} aria-hidden="true" />
                  </Link>
                )}
                <a href={i.url} target="_blank" rel="noopener noreferrer" aria-label="Оригинал" title="Оригинал" className="btn-ghost !px-2 !py-1.5"><ExternalLink size={12} aria-hidden="true" /></a>
                {i.status === 'held' && (
                  <>
                    <button
                      type="button"
                      title={`Вы написали автору, что опубликуете статью: публикация через ${i.delay_hours || 36} ч`}
                      onClick={() => act(async () => (await call(`/items/${i.id}/notify`, { method: 'POST', body: '{}' }), `Публикация через ${i.delay_hours || 36} ч.`))}
                      className="btn-primary !px-2.5 !py-1.5 !text-[11px]"
                    >
                      Написал автору · {i.delay_hours || 36} ч
                    </button>
                    <button type="button" onClick={() => act(async () => (await call(`/items/${i.id}/skip`, { method: 'POST', body: '{}' }), 'Не публикуем.'))} className="btn-ghost !px-2.5 !py-1.5 !text-[11px]">
                      Не публиковать
                    </button>
                  </>
                )}
                {i.status === 'failed' && (
                  <button type="button" onClick={() => act(async () => (await call(`/items/${i.id}/retry`, { method: 'POST' }), 'Повтор поставлен в очередь.'))} className="btn-ghost !px-2.5 !py-1.5 !text-[11px]">
                    <RotateCcw size={12} aria-hidden="true" /> Повторить
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      </section>

      <div className="mt-10 grid gap-8 lg:grid-cols-2">
        {/* Краулеры */}
        <section aria-label="Краулеры">
          <h2 className="font-mono text-[13px] font-bold uppercase tracking-[0.12em]">Краулеры · {crawlers.length}</h2>
          <ul className="mt-3 divide-y divide-border border-y border-border">
            {crawlers.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{c.displayName}</p>
                  <p className="meta truncate !normal-case tracking-normal">@{c.handle} · {c.site}</p>
                </div>
                <button
                  type="button"
                  onClick={() => act(() => call(`/crawlers/${c.id}`, { method: 'PATCH', body: JSON.stringify({ enabled: !c.enabled }) }).then(() => undefined))}
                  className="btn-ghost !px-2.5 !py-1.5 !text-[11px]"
                >
                  {c.enabled ? <><Pause size={12} aria-hidden="true" /> Выключить</> : <><Play size={12} aria-hidden="true" /> Включить</>}
                </button>
              </li>
            ))}
          </ul>
          <form
            onSubmit={(e) =>
              act(async () => {
                await call('/crawlers', { method: 'POST', body: JSON.stringify(newCrawler) })
                setNewCrawler({ id: '', site: '', displayName: '' })
                return 'Краулер создан: аккаунт на PDS готов.'
              }, e)
            }
            className="mt-3 grid gap-2"
          >
            <div className="grid gap-2 sm:grid-cols-2">
              <input value={newCrawler.id} onChange={(e) => setNewCrawler({ ...newCrawler, id: e.target.value })} placeholder="id: habr-2" aria-label="id краулера" required className={inputCls} />
              <input value={newCrawler.site} onChange={(e) => setNewCrawler({ ...newCrawler, site: e.target.value })} placeholder="сайт: habr.com" aria-label="Сайт" required className={inputCls} />
            </div>
            <input value={newCrawler.displayName} onChange={(e) => setNewCrawler({ ...newCrawler, displayName: e.target.value })} placeholder="имя: Краулер Habr №2" aria-label="Отображаемое имя" required className={inputCls} />
            <button type="submit" className="btn-ghost !px-3 !py-2 !text-[11px]">Создать краулер</button>
            <p className="meta !normal-case tracking-normal">handle будет crawler-&lt;id&gt;.{HANDLE_DOMAIN}</p>
          </form>
        </section>

        {/* Источники */}
        <section aria-label="Источники">
          <h2 className="inline-flex items-center gap-2 font-mono text-[13px] font-bold uppercase tracking-[0.12em]">
            <Rss size={13} aria-hidden="true" /> Автопуш из RSS · {sources.length}
          </h2>
          <ul className="mt-3 divide-y divide-border border-y border-border">
            {sources.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{s.url}</p>
                  <p className="meta truncate !normal-case tracking-normal">
                    {s.crawler_id} · каждые {s.interval_min} мин{s.delay_hours ? ` · отсрочка ${s.delay_hours} ч` : ""}{s.max_age_hours ? ` · не старше ${s.max_age_hours} ч` : ""}{s.link_pattern ? " · страница-список" : ""} · опрошен {fmt(s.last_polled_at)}
                    {s.last_error && ` · ошибка: ${s.last_error}`}
                  </p>
                </div>
                <div className="flex gap-2">
                  <button type="button" onClick={() => act(async () => (await call(`/sources/${s.id}/poll`, { method: 'POST' }), 'Опрос запущен.'))} className="btn-ghost !px-2.5 !py-1.5 !text-[11px]">
                    <RefreshCw size={12} aria-hidden="true" /> Сейчас
                  </button>
                  <button
                    type="button"
                    onClick={() => act(() => call(`/sources/${s.id}`, { method: 'PATCH', body: JSON.stringify({ enabled: !s.enabled }) }).then(() => undefined))}
                    className="btn-ghost !px-2.5 !py-1.5 !text-[11px]"
                  >
                    {s.enabled ? <><Pause size={12} aria-hidden="true" /> Пауза</> : <><Play size={12} aria-hidden="true" /> Включить</>}
                  </button>
                </div>
              </li>
            ))}
          </ul>
          <form
            onSubmit={(e) =>
              act(async () => {
                await call('/sources', {
                  method: 'POST',
                  body: JSON.stringify({
                    crawler: newSource.crawler,
                    url: newSource.url.trim(),
                    intervalMin: newSource.intervalMin,
                    delayHours: Number(newSource.delayHours) || 0,
                    ...(newSource.maxAgeHours ? { maxAgeHours: Number(newSource.maxAgeHours) } : {}),
                    ...(newSource.linkPattern.trim() ? { linkPattern: newSource.linkPattern.trim() } : {}),
                  }),
                })
                setNewSource({ ...newSource, url: '' })
                return 'Источник добавлен, первый опрос уже идёт.'
              }, e)
            }
            className="mt-3 grid gap-2 sm:grid-cols-[1fr_160px_110px_auto]"
          >
            <input value={newSource.url} onChange={(e) => setNewSource({ ...newSource, url: e.target.value })} placeholder="https://habr.com/ru/rss/articles/" aria-label="RSS-адрес" required className={inputCls} />
            <select value={newSource.crawler} onChange={(e) => setNewSource({ ...newSource, crawler: e.target.value })} aria-label="Краулер источника" className={inputCls}>
              {crawlers.map((c) => <option key={c.id} value={c.id}>{c.id}</option>)}
            </select>
            <select value={newSource.intervalMin} onChange={(e) => setNewSource({ ...newSource, intervalMin: Number(e.target.value) })} aria-label="Интервал" className={inputCls}>
              {[15, 30, 60, 180, 720, 1440].map((m) => <option key={m} value={m}>{m < 60 ? `${m} мин` : `${m / 60} ч`}</option>)}
            </select>
            <button type="submit" className="btn-ghost !px-3 !py-2 !text-[11px]">Добавить</button>
            <input value={newSource.delayHours} onChange={(e) => setNewSource({ ...newSource, delayHours: e.target.value })} inputMode="numeric" placeholder="отсрочка, ч" title="публиковать через N часов после выхода оригинала" aria-label="Отсрочка в часах" className={inputCls} />
            <input value={newSource.maxAgeHours} onChange={(e) => setNewSource({ ...newSource, maxAgeHours: e.target.value })} inputMode="numeric" placeholder="не старше, ч" title="брать из ленты только записи моложе N часов" aria-label="Не старше, часов" className={inputCls} />
            <input value={newSource.linkPattern} onChange={(e) => setNewSource({ ...newSource, linkPattern: e.target.value })} placeholder="без RSS: ^/blog/articles/.+" title="страница-список без RSS: регулярка пути статей" aria-label="Шаблон ссылок" className={`${inputCls} sm:col-span-2`} />
          </form>
        </section>
        {staffToken() && <StandardAllowPanel token={staffToken()!} />}
      </div>
    </div>
  )
}
