import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { AppWindow, BookOpen, Copy, FlaskConical, KeyRound, RefreshCw, Trash2 } from 'lucide-react'
import { useStore } from '@/lib/store'
import Reveal from '@/components/Reveal'
import { developer, hasSession, type OAuthApp, type PersonalToken, type TokenScope } from '@/lib/api'
import { SITE_NAME, SITE_URL } from '@/config/site'
import { safeHref } from '@/lib/safeUrl'

const inputCls =
  'w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

const SCOPE_LABEL: Record<TokenScope, string> = {
  'articles:write': 'Публиковать статьи',
  'articles:delete': 'Удалять статьи',
  'comments:read': 'Читать свои комментарии',
  'comments:write': 'Писать и удалять комментарии',
  'profile:read': 'Читать профиль',
  'profile:update': 'Менять имя и описание профиля',
}
const EXPIRY = [
  { days: 7, label: '7 дней' },
  { days: 30, label: '30 дней' },
  { days: 90, label: '90 дней' },
  { days: 365, label: '1 год' },
  { days: null, label: 'Бессрочно' },
] as const

const date = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('ru-RU') : '—')

/** Секрет виден один раз: блок с копированием, пока пользователь не закроет */
function SecretOnce({ label, value, onClose }: { label: string; value: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="mt-4 border border-accent/60 bg-accent/5 p-4" role="status">
      <p className="text-sm font-bold">{label}</p>
      <p className="mt-1 text-xs text-muted-foreground">Скопируйте сейчас — больше его не покажем.</p>
      <div className="mt-3 flex gap-2">
        <code className="min-w-0 flex-1 truncate rounded-md border border-border bg-background px-3 py-2 text-xs">{value}</code>
        <button
          type="button"
          className="btn-ghost shrink-0"
          onClick={() => navigator.clipboard.writeText(value).then(() => setCopied(true), () => {})}
        >
          <Copy size={14} aria-hidden="true" /> {copied ? 'Скопировано' : 'Копировать'}
        </button>
      </div>
      <button type="button" className="mt-3 text-xs text-muted-foreground underline" onClick={onClose}>
        Сохранено, скрыть
      </button>
    </div>
  )
}

/** Разработчикам: персональные токены для публикации и OAuth-приложения «Войти через weat.media» */
export default function DeveloperSettingsPage() {
  const sessionActive = hasSession()
  const { prefs, setPrefs } = useStore()
  const [tokens, setTokens] = useState<PersonalToken[]>([])
  const [apps, setApps] = useState<OAuthApp[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [secret, setSecret] = useState<{ label: string; value: string } | null>(null)

  const [tName, setTName] = useState('')
  const [tScopes, setTScopes] = useState<TokenScope[]>(['articles:write'])
  const [tDays, setTDays] = useState<number | null>(90)

  const [aName, setAName] = useState('')
  const [aHome, setAHome] = useState('')
  const [aRedirects, setARedirects] = useState('')

  const load = useCallback(() => {
    Promise.all([developer.tokens(), developer.apps()]).then(
      ([t, a]) => {
        setTokens(t)
        setApps(a)
      },
      (e) => setError(e instanceof Error ? e.message : 'Не удалось загрузить'),
    )
  }, [])
  useEffect(() => {
    if (sessionActive) load()
  }, [sessionActive, load])

  const act = async (fn: () => Promise<void>, e?: FormEvent) => {
    e?.preventDefault()
    setError('')
    setBusy(true)
    try {
      await fn()
      load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось выполнить запрос')
    } finally {
      setBusy(false)
    }
  }

  if (!sessionActive) {
    return (
      <Reveal className="border border-border p-6">
        <p className="text-sm">Это демо-аккаунт. Токены и приложения доступны после входа через аккаунт {SITE_NAME}.</p>
      </Reveal>
    )
  }

  const toggleScope = (s: TokenScope) => setTScopes((cur) => (cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s]))
  const curl = `curl -X POST ${SITE_URL}/api/v1/articles \\
  -H "Authorization: Bearer wm_pat_…" \\
  -H "Content-Type: application/json" \\
  -d '{"title":"Привет","text":"# Первая статья через API"}'`

  return (
    <div className="space-y-12">
      <div>
        <h2 className="text-2xl font-extrabold tracking-tight">Разработчикам</h2>
        <p className="mt-2 max-w-[62ch] text-sm text-muted-foreground">
          Публикуйте из скриптов и CI по персональному токену или подключите вход «Войти через {SITE_NAME}» на свой сайт.
        </p>
        <Link to="/api" className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-accent hover:underline">
          <BookOpen size={14} aria-hidden="true" /> Документация API
        </Link>
      </div>

      <section aria-labelledby="dp-h" className="border border-dashed border-border p-5">
        <h3 id="dp-h" className="flex items-center gap-2 text-lg font-extrabold">
          <FlaskConical size={17} className="text-accent" aria-hidden="true" /> Developer preview
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Экспериментальные блоки редактора. Сейчас: «Интерактивное видео» — главы, кнопки на кадре, вопросы по ходу и ветвление
          сюжета. Формат может меняться; опубликованные статьи читатели видят всегда.
        </p>
        <label className="mt-4 flex w-fit cursor-pointer items-center gap-2.5 text-sm font-semibold">
          <input type="checkbox" className="h-4 w-4 shrink-0" checked={!!prefs.devPreview} onChange={(e) => setPrefs({ devPreview: e.target.checked })} />
          Включить экспериментальные блоки в «/»-меню
        </label>
      </section>

      {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
      {secret && <SecretOnce label={secret.label} value={secret.value} onClose={() => setSecret(null)} />}

      {/* Персональные токены */}
      <section aria-labelledby="pat-h">
        <h3 id="pat-h" className="flex items-center gap-2 text-lg font-extrabold">
          <KeyRound size={17} className="text-accent" aria-hidden="true" /> Персональные токены
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Токен действует от вашего имени только в выбранных правах. Отзыв мгновенно закрывает доступ к вашему архиву публикаций.
        </p>

        <form
          className="mt-5 grid gap-4 border border-border p-5"
          onSubmit={(e) =>
            act(async () => {
              const r = await developer.createToken({ name: tName, scopes: tScopes, expiresInDays: tDays })
              setSecret({ label: `Токен «${r.name}»`, value: r.token })
              setTName('')
            }, e)
          }
        >
          <label className="grid gap-1.5 text-sm font-semibold">
            Название
            <input className={inputCls} value={tName} onChange={(e) => setTName(e.target.value)} placeholder="GitHub Actions" maxLength={64} required />
          </label>
          <fieldset className="grid gap-2">
            <legend className="text-sm font-semibold">Права</legend>
            {(Object.keys(SCOPE_LABEL) as TokenScope[]).map((s) => (
              <label key={s} className="flex w-fit cursor-pointer items-center justify-start gap-2.5 text-sm">
                <input type="checkbox" className="h-4 w-4 shrink-0" checked={tScopes.includes(s)} onChange={() => toggleScope(s)} />
                <span>{SCOPE_LABEL[s]}</span>
                <code className="text-xs text-muted-foreground">{s}</code>
              </label>
            ))}
          </fieldset>
          <label className="grid gap-1.5 text-sm font-semibold">
            Срок действия
            <select className={inputCls} value={tDays ?? ''} onChange={(e) => setTDays(e.target.value ? Number(e.target.value) : null)}>
              {EXPIRY.map((x) => (
                <option key={x.label} value={x.days ?? ''}>{x.label}</option>
              ))}
            </select>
          </label>
          <div>
            <button type="submit" className="btn-primary" disabled={busy || !tName.trim() || tScopes.length === 0}>
              Выпустить токен
            </button>
          </div>
        </form>

        {tokens.length > 0 && (
          <ul className="mt-5 divide-y divide-border border border-border">
            {tokens.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center gap-3 p-4">
                <div className="min-w-0 flex-1">
                  <p className="font-bold">{t.name}</p>
                  <p className="font-mono text-xs text-muted-foreground">
                    {t.scopes.join(', ')} · создан {date(t.createdAt)} · истекает {t.expiresAt ? date(t.expiresAt) : 'никогда'} · использован {date(t.lastUsedAt)}
                  </p>
                </div>
                <button
                  type="button"
                  className="btn-ghost"
                  disabled={busy}
                  title="Новое значение того же токена: права сохраняются, старое значение перестаёт работать сразу"
                  onClick={() =>
                    confirm(`Перевыпустить «${t.name}»? Старое значение перестанет работать — обновите его в скриптах.`) &&
                    act(async () => {
                      const r = await developer.rotateToken(t.id)
                      setSecret({ label: `Новое значение «${r.name}»`, value: r.token })
                    })
                  }
                >
                  <RefreshCw size={14} aria-hidden="true" /> Ротация
                </button>
                <button
                  type="button"
                  className="btn-ghost"
                  disabled={busy}
                  onClick={() => confirm(`Отозвать токен «${t.name}»? Скрипты с ним перестанут работать.`) && act(() => developer.revokeToken(t.id).then(() => {}))}
                >
                  <Trash2 size={14} aria-hidden="true" /> Отозвать
                </button>
              </li>
            ))}
          </ul>
        )}

        <details className="mt-5 border border-border p-4 text-sm">
          <summary className="cursor-pointer font-semibold">Пример: публикация через API</summary>
          <pre className="mt-3 overflow-x-auto rounded-md bg-secondary p-3 text-xs">{curl}</pre>
          <p className="mt-2 text-muted-foreground">
            Утёк токен, а под рукой только он сам? <code>curl -X DELETE {SITE_URL}/api/v1/token -H "Authorization: Bearer wm_pat_…"</code>{' '}
            — отзовёт его сразу.
          </p>
          <p className="mt-2 text-muted-foreground">
            Статья попадёт в ваш архив как запись <code>media.weat.article</code> и появится в ленте. Все поля —{' '}
            <Link to="/api" className="text-accent hover:underline">в документации</Link>.
          </p>
        </details>
      </section>

      {/* OAuth-приложения */}
      <section aria-labelledby="oauth-h">
        <h3 id="oauth-h" className="flex items-center gap-2 text-lg font-extrabold">
          <AppWindow size={17} className="text-accent" aria-hidden="true" /> OAuth-приложения
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Кнопка «Войти через {SITE_NAME}» на вашем сайте (OpenID Connect). Зарегистрируйте приложение — получите Client ID и
          секрет. Вход по этим данным заработает с запуском сервера авторизации {SITE_NAME}; регистрировать можно уже сейчас.
        </p>

        <form
          className="mt-5 grid gap-4 border border-border p-5"
          onSubmit={(e) =>
            act(async () => {
              const r = await developer.createApp({
                name: aName,
                homepageUrl: aHome,
                redirectUris: aRedirects.split(/\s+/).filter(Boolean),
              })
              setSecret({ label: `Секрет приложения «${r.name}» (Client ID: ${r.clientId})`, value: r.clientSecret })
              setAName('')
              setAHome('')
              setARedirects('')
            }, e)
          }
        >
          <label className="grid gap-1.5 text-sm font-semibold">
            Название (видят пользователи при входе)
            <input className={inputCls} value={aName} onChange={(e) => setAName(e.target.value)} maxLength={80} required />
          </label>
          <label className="grid gap-1.5 text-sm font-semibold">
            Сайт
            <input className={inputCls} type="url" value={aHome} onChange={(e) => setAHome(e.target.value)} placeholder="https://example.com" required />
          </label>
          <label className="grid gap-1.5 text-sm font-semibold">
            Redirect URI — по одному на строку
            <textarea
              className={inputCls}
              rows={3}
              value={aRedirects}
              onChange={(e) => setARedirects(e.target.value)}
              placeholder={'https://example.com/auth/callback\nhttp://localhost:5173/auth/callback'}
              required
            />
            <span className="text-xs font-normal text-muted-foreground">Только https://; http:// — для localhost.</span>
          </label>
          <div>
            <button type="submit" className="btn-primary" disabled={busy}>Зарегистрировать</button>
          </div>
        </form>

        {apps.length > 0 && (
          <ul className="mt-5 divide-y divide-border border border-border">
            {apps.map((a) => (
              <li key={a.clientId} className="grid gap-2 p-4">
                <div className="flex flex-wrap items-center gap-3">
                  <p className="min-w-0 flex-1 font-bold">
                    {a.name}{' '}
                    <a href={safeHref(a.homepageUrl)} target="_blank" rel="noreferrer" className="text-xs font-normal text-muted-foreground hover:underline">
                      {a.homepageUrl}
                    </a>
                  </p>
                  <button
                    type="button"
                    className="btn-ghost"
                    disabled={busy}
                    onClick={() =>
                      confirm('Перевыпустить секрет? Старый перестанет работать сразу.') &&
                      act(async () => {
                        const r = await developer.rotateSecret(a.clientId)
                        setSecret({ label: `Новый секрет «${r.name}»`, value: r.clientSecret })
                      })
                    }
                  >
                    <RefreshCw size={14} aria-hidden="true" /> Новый секрет
                  </button>
                  <button
                    type="button"
                    className="btn-ghost"
                    disabled={busy}
                    onClick={() => confirm(`Удалить приложение «${a.name}»?`) && act(() => developer.deleteApp(a.clientId).then(() => {}))}
                  >
                    <Trash2 size={14} aria-hidden="true" /> Удалить
                  </button>
                </div>
                <p className="font-mono text-xs text-muted-foreground">Client ID: {a.clientId}</p>
                <p className="font-mono text-xs text-muted-foreground">Redirect: {a.redirectUris.join(' · ')}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
