import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router'
import { ArrowLeft, Check, ChevronRight, Copy, Download, Lock, Terminal } from 'lucide-react'
import Reveal from '@/components/Reveal'
import { HANDLE_DOMAIN, SITE_NAME } from '@/config/site'

/* ── минимальные типы OpenAPI 3.1, которые мы рисуем ─────────────────── */
interface JsonSchema {
  type?: string | string[]
  properties?: Record<string, JsonSchema>
  required?: string[]
  items?: JsonSchema
  enum?: unknown[]
  const?: unknown
  anyOf?: JsonSchema[]
  oneOf?: JsonSchema[]
  additionalProperties?: JsonSchema | boolean
  description?: string
  format?: string
  pattern?: string
  minLength?: number
  maxLength?: number
  minimum?: number
  maximum?: number
  maxItems?: number
  $ref?: string
}
interface Parameter {
  name: string
  in: 'path' | 'query'
  required: boolean
  description?: string
}
interface Operation {
  tags: string[]
  summary: string
  description?: string
  operationId: string
  parameters?: Parameter[]
  requestBody?: { content: { 'application/json': { schema: JsonSchema } } }
  security?: Record<string, unknown>[]
  responses: Record<string, { description: string; content?: { 'application/json': { schema: JsonSchema } } }>
}
interface Spec {
  info: { title: string; version: string; description: string }
  servers: { url: string }[]
  tags: { name: string; description: string }[]
  paths: Record<string, Record<string, Operation>>
}

const SPEC_URL = `${import.meta.env.VITE_API_URL ?? '/api'}/openapi.json`

/* методы окрашены токенами темы — страница следует выбранному акценту и тёмной теме */
const METHOD_STYLE: Record<string, string> = {
  get: 'bg-secondary text-secondary-foreground border-border',
  post: 'bg-accent text-accent-foreground border-accent',
  put: 'bg-primary text-primary-foreground border-primary',
  patch: 'bg-primary text-primary-foreground border-primary',
  delete: 'bg-destructive text-destructive-foreground border-destructive',
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-zа-я0-9]+/gi, '-')

/* ── схема -> строки таблицы ──────────────────────────────────────────── */
function typeLabel(s: JsonSchema): string {
  if (s.const !== undefined) return JSON.stringify(s.const)
  if (s.enum) return s.enum.map((v) => JSON.stringify(v)).join(' | ')
  const variants = s.anyOf ?? s.oneOf
  if (variants) return variants.map(typeLabel).join(' | ')
  if (s.type === 'array') return `${s.items ? typeLabel(s.items) : 'any'}[]`
  if (Array.isArray(s.type)) return s.type.join(' | ')
  if (s.type === 'object' && !s.properties && s.additionalProperties && typeof s.additionalProperties === 'object') {
    return `{ [key]: ${typeLabel(s.additionalProperties)} }`
  }
  return s.format ? `${s.type} · ${s.format}` : (s.type ?? 'any')
}

function constraints(s: JsonSchema): string[] {
  const out: string[] = []
  if (s.minLength !== undefined && s.maxLength !== undefined) out.push(`${s.minLength}–${s.maxLength} симв.`)
  else if (s.minLength !== undefined) out.push(`от ${s.minLength} симв.`)
  else if (s.maxLength !== undefined) out.push(`до ${s.maxLength} симв.`)
  if (s.minimum !== undefined) out.push(`≥ ${s.minimum}`)
  if (s.maximum !== undefined) out.push(`≤ ${s.maximum}`)
  if (s.maxItems !== undefined) out.push(`до ${s.maxItems} эл.`)
  // формат email читаемее регулярки, которую генерирует zod
  if (s.pattern && !s.format) out.push(`/${s.pattern}/`)
  return out
}

/** вложенный объект — свой блок; поле nullable = anyOf [X, null] разворачиваем */
function objectOf(s: JsonSchema): JsonSchema | null {
  if (s.type === 'object' && s.properties) return s
  if (s.type === 'array' && s.items) return objectOf(s.items)
  const variants = (s.anyOf ?? []).filter((v) => v.type !== 'null')
  if (variants.length === 1) return objectOf(variants[0]!)
  return null
}

function SchemaTable({ schema, depth = 0 }: { schema: JsonSchema; depth?: number }) {
  const variants = schema.anyOf ?? schema.oneOf
  if (variants && !schema.properties) {
    return (
      <div className="space-y-3">
        {variants.map((v, i) => (
          <div key={i}>
            <p className="meta mb-1">{i === 0 ? 'вариант 1' : `или вариант ${i + 1}`}</p>
            <SchemaTable schema={v} depth={depth} />
          </div>
        ))}
      </div>
    )
  }
  if (!schema.properties) return <p className="font-mono text-[12px] text-muted-foreground">{typeLabel(schema)}</p>
  const required = new Set(schema.required ?? [])
  return (
    <ul className={depth ? 'mt-2 border-l border-border pl-4' : ''}>
      {Object.entries(schema.properties).map(([name, prop]) => {
        const nested = objectOf(prop)
        const c = constraints(prop)
        return (
          <li key={name} className="border-b border-border/70 py-2.5 last:border-b-0">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <code className="font-mono text-[13px] font-semibold">{name}</code>
              <span className="font-mono text-[11px] text-accent">{typeLabel(prop)}</span>
              {required.has(name) ? (
                <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-destructive">обязательно</span>
              ) : (
                <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-muted-foreground">опционально</span>
              )}
              {c.map((x) => (
                <span key={x} className="rounded bg-secondary px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">{x}</span>
              ))}
            </div>
            {prop.description && <p className="mt-1 text-sm text-muted-foreground">{prop.description}</p>}
            {nested && nested !== prop && <SchemaTable schema={nested} depth={depth + 1} />}
            {nested && nested === prop && <SchemaTable schema={prop} depth={depth + 1} />}
          </li>
        )
      })}
    </ul>
  )
}

/* ── пример запроса ───────────────────────────────────────────────────── */
const HINTS: Record<string, unknown> = {
  username: 'alina',
  email: 'alina@example.com',
  password: 'correct-horse-battery',
  identifier: `alina.${HANDLE_DOMAIN}`,
  handle: 'alice.bsky.social',
  code: '123456',
  token: 'ABCDE-FGHIJ',
  refreshJwt: 'eyJ…',
  mfaToken: 'v1.…',
  returnTo: '/compose',
  displayName: 'Алина',
}

function example(s: JsonSchema, name = ''): unknown {
  if (name in HINTS) return HINTS[name]
  if (s.const !== undefined) return s.const
  if (s.enum) return s.enum[0]
  const variants = s.anyOf ?? s.oneOf
  if (variants) return example(variants.find((v) => v.type !== 'null') ?? variants[0]!, name)
  if (s.type === 'object') {
    if (!s.properties) return {}
    const req = new Set(s.required ?? [])
    return Object.fromEntries(
      Object.entries(s.properties)
        .filter(([k]) => req.has(k) || k in HINTS)
        .map(([k, v]) => [k, example(v, k)]),
    )
  }
  if (s.type === 'array') return s.items ? [example(s.items)] : []
  if (s.type === 'boolean') return true
  if (s.type === 'integer' || s.type === 'number') return s.minimum ?? 1
  return 'string'
}

function curlFor(base: string, method: string, path: string, op: Operation): string {
  const url = `${base}${path.replace('{provider}', 'yandex').replace('{did}', 'did:plc:…').replace('{id}', `alina.${HANDLE_DOMAIN}`)}`
  const query = (op.parameters ?? []).filter((p) => p.in === 'query' && p.required).map((p) => `${p.name}=${encodeURIComponent(String(HINTS[p.name] ?? '…'))}`)
  const lines = [`curl -X ${method.toUpperCase()} "${url}${query.length ? `?${query.join('&')}` : ''}"`]
  if (op.security) lines.push(`  -H "Authorization: Bearer $ACCESS_JWT"`)
  const body = op.requestBody?.content['application/json'].schema
  if (body) {
    lines.push(`  -H "Content-Type: application/json"`)
    lines.push(`  -d '${JSON.stringify(example(body))}'`)
  }
  return lines.join(' \\\n')
}

/* ── карточка операции ────────────────────────────────────────────────── */
function OperationCard({ method, path, op, base }: { method: string; path: string; op: Operation; base: string }) {
  const [open, setOpen] = useState(() => typeof window !== 'undefined' && window.location.hash === `#${op.operationId}`)
  const [copied, setCopied] = useState(false)
  const curl = curlFor(base, method, path, op)
  const body = op.requestBody?.content['application/json'].schema
  const params = op.parameters ?? []

  return (
    <article id={op.operationId} className="scroll-mt-24 border border-border bg-background">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full cursor-pointer items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-secondary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className={`w-[68px] shrink-0 rounded border py-1 text-center font-mono text-[11px] font-bold uppercase tracking-[0.06em] ${METHOD_STYLE[method] ?? METHOD_STYLE.get}`}>
          {method}
        </span>
        <code className="min-w-0 flex-1 truncate font-mono text-[13px]">{path}</code>
        <span className="hidden flex-1 truncate text-sm text-muted-foreground md:block">{op.summary}</span>
        {op.security && <Lock size={13} className="shrink-0 text-muted-foreground" aria-label="Нужна авторизация" />}
        <ChevronRight size={15} className={`shrink-0 transition-transform ${open ? 'rotate-90' : ''}`} aria-hidden="true" />
      </button>

      {open && (
        <div className="space-y-5 border-t border-border px-4 py-4">
          <div>
            <p className="text-[15px] font-semibold md:hidden">{op.summary}</p>
            {op.description && <p className="mt-1 max-w-[72ch] text-sm leading-relaxed text-muted-foreground">{op.description}</p>}
            {op.security && (
              <p className="meta mt-2 inline-flex items-center gap-1.5 !normal-case tracking-normal">
                <Lock size={11} aria-hidden="true" />
                {'adminToken' in (op.security[0] ?? {}) ? 'Authorization: Bearer ADMIN_TOKEN' : 'Authorization: Bearer accessJwt'}
              </p>
            )}
          </div>

          {params.length > 0 && (
            <section>
              <h4 className="meta mb-1">Параметры</h4>
              <ul>
                {params.map((p) => (
                  <li key={`${p.in}-${p.name}`} className="flex flex-wrap items-baseline gap-x-2 border-b border-border/70 py-2 last:border-b-0">
                    <code className="font-mono text-[13px] font-semibold">{p.name}</code>
                    <span className="font-mono text-[11px] text-accent">{p.in}</span>
                    {p.required && <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-destructive">обязательно</span>}
                    {p.description && <span className="text-sm text-muted-foreground">{p.description}</span>}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {body && (
            <section>
              <h4 className="meta mb-1">Тело запроса · application/json</h4>
              <SchemaTable schema={body} />
            </section>
          )}

          <section>
            <h4 className="meta mb-2">Ответы</h4>
            <ul className="space-y-2">
              {Object.entries(op.responses).map(([status, r]) => {
                const ok = status.startsWith('2') || status.startsWith('3')
                const schema = r.content?.['application/json'].schema
                return (
                  <li key={status}>
                    <details className="group">
                      <summary className={`flex cursor-pointer list-none items-center gap-3 ${schema && ok ? '' : 'cursor-default'}`}>
                        <span className={`rounded px-2 py-0.5 font-mono text-[12px] font-bold ${ok ? 'bg-accent/15 text-accent' : 'bg-destructive/10 text-destructive'}`}>
                          {status}
                        </span>
                        <span className="font-mono text-[12px] text-muted-foreground">{r.description}</span>
                        {schema && ok && <ChevronRight size={13} className="transition-transform group-open:rotate-90" aria-hidden="true" />}
                      </summary>
                      {schema && ok && (
                        <div className="mt-2 border-l-2 border-accent/40 pl-4">
                          <SchemaTable schema={schema} />
                        </div>
                      )}
                    </details>
                  </li>
                )
              })}
            </ul>
          </section>

          <section>
            <div className="mb-2 flex items-center justify-between">
              <h4 className="meta inline-flex items-center gap-1.5"><Terminal size={11} aria-hidden="true" /> Пример</h4>
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard?.writeText(curl)
                  setCopied(true)
                  setTimeout(() => setCopied(false), 1500)
                }}
                className="inline-flex items-center gap-1 font-mono text-[11px] text-muted-foreground hover:text-accent"
              >
                {copied ? <Check size={12} aria-hidden="true" /> : <Copy size={12} aria-hidden="true" />} {copied ? 'скопировано' : 'копировать'}
              </button>
            </div>
            <pre className="overflow-x-auto rounded-md bg-primary p-4 text-[12px] leading-relaxed text-primary-foreground">
              <code>{curl}</code>
            </pre>
          </section>
        </div>
      )}
    </article>
  )
}

/** /api: справочник REST API AppView из OpenAPI-спецификации, оформленный в стиле сайта */
export default function ApiDocsPage() {
  const [spec, setSpec] = useState<Spec | null>(null)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')

  useEffect(() => {
    fetch(SPEC_URL)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then(setSpec, () => setError('Не удалось загрузить спецификацию. Сервер API запущен?'))
  }, [])

  const groups = useMemo(() => {
    if (!spec) return []
    const q = query.trim().toLowerCase()
    return spec.tags
      .map((tag) => ({
        tag,
        ops: Object.entries(spec.paths).flatMap(([path, methods]) =>
          Object.entries(methods)
            .filter(([, op]) => op.tags.includes(tag.name))
            .filter(([m, op]) => !q || `${m} ${path} ${op.summary} ${op.description ?? ''}`.toLowerCase().includes(q))
            .map(([method, op]) => ({ method, path, op })),
        ),
      }))
      .filter((g) => g.ops.length > 0)
  }, [spec, query])

  const base = spec ? `${window.location.origin}${spec.servers[0]?.url ?? '/api'}` : ''
  const total = groups.reduce((n, g) => n + g.ops.length, 0)

  return (
    <div className="mx-auto max-w-[1200px] px-5 pb-24 md:px-8">
      <div className="pt-10">
        <Link
          to="/feed"
          className="inline-flex items-center gap-2 font-mono text-[12px] font-semibold uppercase tracking-[0.08em] text-muted-foreground transition-colors hover:text-accent"
        >
          <ArrowLeft size={13} aria-hidden="true" /> Лента
        </Link>
        <p className="meta mt-8">Для разработчиков · REST · OpenAPI 3.1</p>
        <h1 className="mt-2 text-4xl font-extrabold tracking-tight md:text-5xl">API {SITE_NAME}</h1>
        <p className="mt-4 max-w-[68ch] text-[15px] leading-relaxed text-muted-foreground">
          {spec?.info.description ?? 'Аккаунты, вход, безопасность и настройки.'} Справочник собирается из той же
          схемы, что проверяет запросы на сервере, — расхождений между документацией и API нет.
        </p>
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <a href={SPEC_URL} download="indie-media-openapi.json" className="btn-primary !px-4 !py-2">
            <Download size={14} aria-hidden="true" /> openapi.json
          </a>
          {spec && <code className="rounded border border-border px-3 py-2 font-mono text-[12px]">{base}</code>}
          {spec && <span className="meta">v{spec.info.version}</span>}
        </div>
      </div>

      {error && <p role="alert" className="mt-10 border border-destructive/60 bg-destructive/5 p-4 text-sm">{error}</p>}
      {!spec && !error && <p className="meta mt-10" role="status">загружаем спецификацию…</p>}

      {spec && (
        <div className="mt-10 grid gap-10 lg:grid-cols-[220px_minmax(0,1fr)]">
          <nav aria-label="Разделы API" className="lg:sticky lg:top-24 lg:self-start">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="поиск: login, 2fa…"
              aria-label="Поиск по API"
              className="mb-4 w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <ul className="flex gap-1 overflow-x-auto lg:flex-col">
              {groups.map((g) => (
                <li key={g.tag.name} className="shrink-0">
                  <a href={`#${slug(g.tag.name)}`} className="flex items-center justify-between gap-3 rounded-md px-3 py-2 font-mono text-[12px] font-semibold tracking-[0.03em] hover:bg-secondary hover:text-accent">
                    {g.tag.name} <span className="text-muted-foreground">{g.ops.length}</span>
                  </a>
                </li>
              ))}
            </ul>
            <p className="meta mt-4 hidden lg:block">{total} операций</p>
          </nav>

          <div className="min-w-0 space-y-12">
            {groups.length === 0 && <p className="text-sm text-muted-foreground">Ничего не найдено по «{query}».</p>}
            {groups.map((g) => (
              <Reveal key={g.tag.name}>
                <section id={slug(g.tag.name)} aria-label={g.tag.name} className="scroll-mt-24">
                  <h2 className="text-2xl font-extrabold tracking-tight">{g.tag.name}</h2>
                  <p className="mt-1 max-w-[72ch] text-sm text-muted-foreground">{g.tag.description}</p>
                  <div className="mt-4 space-y-2">
                    {g.ops.map(({ method, path, op }) => (
                      <OperationCard key={op.operationId} method={method} path={path} op={op} base={base} />
                    ))}
                  </div>
                </section>
              </Reveal>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
