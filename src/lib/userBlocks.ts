/**
 * Пользовательские блоки (Premium): автор сам собирает блок в конструкторе
 * или пишет HTML/CSS-шаблон. Модуль без фреймворка — им пользуются и Lit-блок
 * редактора (customBlocks), и React-страницы (статья, настройки).
 *
 * Безопасность: значения полей всегда экранируются; визуальный режим собирается
 * только из наших пресетов; режим кода рендерится в <iframe sandbox> без скриптов
 * и same-origin, с CSP default-src 'none' — шаблон автора не может выполнить код
 * в ленте читателя.
 */
import { SITE_URL } from '@/config/site'

export const USER_BLOCK_FLAVOUR = 'affine:userblock'

export type FieldType = 'text' | 'textarea' | 'select' | 'image' | 'link' | 'color'
export const FIELD_TYPES: { type: FieldType; label: string }[] = [
  { type: 'text', label: 'Строка' },
  { type: 'textarea', label: 'Многострочный текст' },
  { type: 'select', label: 'Выбор из списка' },
  { type: 'image', label: 'Картинка (https)' },
  { type: 'link', label: 'Ссылка (https)' },
  { type: 'color', label: 'Цвет' },
]

export interface FieldDef {
  key: string
  label: string
  type: FieldType
  /** для select */
  options?: string[]
  default?: string
}

export type Preset = 'callout' | 'card' | 'quote' | 'banner'
export const PRESETS: { preset: Preset; label: string }[] = [
  { preset: 'callout', label: 'Заметка: иконка + текст, полоса слева' },
  { preset: 'card', label: 'Карточка: картинка, заголовок, текст' },
  { preset: 'quote', label: 'Цитата: крупный текст и подпись' },
  { preset: 'banner', label: 'Плашка: заливка на всю ширину' },
]

export interface BlockDef {
  id: string
  name: string
  icon: string
  description: string
  mode: 'visual' | 'code'
  fields: FieldDef[]
  // visual
  preset: Preset
  accent: string
  background: string
  // code
  template: string
  css: string
  /** высота iframe в режиме кода (скрипты запрещены — авто-высоту не измерить) */
  height: number
  updatedAt: string
}

/** Содержимое блока в документе: снимок определения + значения полей */
export interface UserBlockData {
  def: BlockDef
  values: Record<string, string>
}

export const LIMITS = { defs: 30, fields: 12, name: 40, template: 10_000, css: 10_000, value: 2_000 }

const HEX = /^#[0-9a-f]{3,8}$/i
const KEY = /^[a-z][a-z0-9_]{0,23}$/

export const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')

export const safeUrl = (s: string | undefined) => (s && /^https:\/\/[^\s"'<>]+$/i.test(s.trim()) ? s.trim() : '')
export const safeColor = (s: string | undefined, fallback: string) => (s && HEX.test(s.trim()) ? s.trim() : fallback)

const clip = (s: unknown, n: number) => String(s ?? '').slice(0, n)

export function newId(): string {
  return `ub_${Math.random().toString(36).slice(2, 10)}`
}

export function normalizeDef(raw: Partial<BlockDef>): BlockDef {
  const fields = (Array.isArray(raw.fields) ? raw.fields : [])
    .slice(0, LIMITS.fields)
    .map((f): FieldDef => ({
      key: KEY.test(String(f?.key)) ? String(f.key) : 'field',
      label: clip(f?.label, 40) || 'Поле',
      type: FIELD_TYPES.some((t) => t.type === f?.type) ? f.type : 'text',
      ...(f?.type === 'select' ? { options: (f.options ?? []).map((o) => clip(o, 40)).filter(Boolean).slice(0, 12) } : {}),
      ...(f?.default ? { default: clip(f.default, LIMITS.value) } : {}),
    }))
    // ключи уникальны: дубликат получает суффикс
    .map((f, i, arr) => (arr.findIndex((x) => x.key === f.key) === i ? f : { ...f, key: `${f.key}_${i}`.slice(0, 24) }))
  return {
    id: /^ub_[a-z0-9]{4,16}$/.test(String(raw.id)) ? String(raw.id) : newId(),
    name: clip(raw.name, LIMITS.name) || 'Мой блок',
    icon: clip(raw.icon, 4) || '✦',
    description: clip(raw.description, 80),
    mode: raw.mode === 'code' ? 'code' : 'visual',
    fields,
    preset: PRESETS.some((p) => p.preset === raw.preset) ? (raw.preset as Preset) : 'callout',
    accent: safeColor(raw.accent, '#bc773f'),
    background: safeColor(raw.background, '#faf6f1'),
    template: clip(raw.template, LIMITS.template),
    css: clip(raw.css, LIMITS.css),
    height: Math.min(600, Math.max(60, Number(raw.height) || 160)),
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : new Date().toISOString(),
  }
}

export function defaultValues(def: BlockDef): Record<string, string> {
  return Object.fromEntries(
    def.fields.map((f) => [f.key, f.default ?? (f.type === 'select' ? (f.options?.[0] ?? '') : f.type === 'color' ? def.accent : '')]),
  )
}

export function parseUserBlock(raw: string): UserBlockData | null {
  try {
    const j = JSON.parse(raw) as Partial<UserBlockData>
    if (!j.def) return null
    const def = normalizeDef(j.def)
    const values = Object.fromEntries(
      def.fields.map((f) => [f.key, clip(j.values?.[f.key] ?? defaultValues(def)[f.key], LIMITS.value)]),
    )
    return { def, values }
  } catch {
    return null
  }
}

/** Для не-Premium и для поиска: блок превращается в обычный текст */
export function fallbackText(data: UserBlockData): string {
  return data.def.fields
    .filter((f) => f.type !== 'color')
    .map((f) => data.values[f.key]?.trim())
    .filter(Boolean)
    .join(' — ')
}

/* ── визуальный режим: только наши пресеты, все значения экранированы ── */
export function renderVisualHtml(data: UserBlockData): string {
  const { def, values } = data
  const byType = (t: FieldType) => def.fields.filter((f) => f.type === t)
  const val = (f?: FieldDef) => (f ? (values[f.key] ?? '') : '')
  const colorField = byType('color')[0]
  const accent = safeColor(colorField ? val(colorField) : undefined, def.accent)
  const bg = def.background
  // поле с ключом icon — иконка блока; остальные строки — заголовок и подписи
  const iconField = def.fields.find((f) => f.key === 'icon' && f.type === 'text')
  const icon = escapeHtml(clip(val(iconField) || def.icon, 4))
  const texts = def.fields.filter((f) => (f.type === 'text' || f.type === 'select') && f !== iconField)
  const longs = byType('textarea')
  const img = safeUrl(val(byType('image')[0]))
  const link = safeUrl(val(byType('link')[0]))
  const title = escapeHtml(val(texts[0]))
  const rest = texts.slice(1).map((f) => `<span class="ub-meta">${escapeHtml(val(f))}</span>`).join('')
  const body = longs.map((f) => `<p class="ub-text">${escapeHtml(val(f)).replace(/\n/g, '<br>')}</p>`).join('')
  const linkHtml = link ? `<a class="ub-link" href="${escapeHtml(link)}" target="_blank" rel="noopener noreferrer nofollow">${escapeHtml(link.replace(/^https:\/\//, ''))}</a>` : ''
  const style = `--ub-accent:${accent};--ub-bg:${bg}`

  switch (def.preset) {
    case 'card':
      return `<div class="ub ub--card" style="${style}">${img ? `<img class="ub-img" src="${escapeHtml(img)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ''}<div class="ub-body">${title ? `<p class="ub-title">${title}</p>` : ''}${rest}${body}${linkHtml}</div></div>`
    case 'quote':
      return `<figure class="ub ub--quote" style="${style}">${body || `<p class="ub-text">${title}</p>`}<figcaption class="ub-meta">${body ? title : ''}${rest}</figcaption>${linkHtml}</figure>`
    case 'banner':
      return `<div class="ub ub--banner" style="${style}"><span class="ub-icon">${icon}</span><div class="ub-body">${title ? `<p class="ub-title">${title}</p>` : ''}${rest}${body}${linkHtml}</div></div>`
    default:
      return `<div class="ub ub--callout" style="${style}"><span class="ub-icon">${icon}</span><div class="ub-body">${title ? `<p class="ub-title">${title}</p>` : ''}${rest}${body}${linkHtml}</div></div>`
  }
}

/** CSS визуальных пресетов (подключается и в shadow DOM блока, и на странице статьи) */
export const VISUAL_CSS = `
.ub{border-radius:8px;margin:8px 0;color:inherit;font:inherit;line-height:1.55}
.ub-title{margin:0 0 4px;font-weight:700}
.ub-text{margin:4px 0 0;white-space:normal}
.ub-meta{display:block;font-size:.82em;opacity:.7;margin-top:4px}
.ub-link{display:inline-block;margin-top:6px;font-size:.85em;color:var(--ub-accent);text-decoration:underline;text-underline-offset:3px;word-break:break-all}
.ub-icon{flex:0 0 auto;font-size:1.3em;line-height:1.3}
.ub--callout{display:flex;gap:12px;padding:12px 14px;border:1px solid color-mix(in srgb,var(--ub-accent) 30%,transparent);border-left:3px solid var(--ub-accent);background:color-mix(in srgb,var(--ub-accent) 8%,transparent)}
.ub--card{border:1px solid color-mix(in srgb,var(--ub-accent) 25%,#8884);overflow:hidden;background:var(--ub-bg);color:#1c1917}
.ub--card .ub-body{padding:12px 14px}
.ub-img{display:block;width:100%;max-height:260px;object-fit:cover}
.ub--quote{margin:12px 0;padding:6px 0 6px 18px;border-left:4px solid var(--ub-accent)}
.ub--quote .ub-text{font-size:1.2em;font-weight:600;margin:0}
.ub--quote figcaption{margin-top:6px}
.ub--banner{display:flex;gap:12px;align-items:flex-start;padding:16px 18px;background:var(--ub-accent);color:#fff}
.ub--banner .ub-link{color:#fff}
`

/* ── режим кода: шаблон автора в изолированном iframe ── */
const CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src https: data:; font-src data:; form-action 'none'"

export function renderCodeSrcdoc(data: UserBlockData): string {
  const { def, values } = data
  const html = def.template.replace(/\{\{\s*([a-z][a-z0-9_]*)\s*\}\}/g, (_, key: string) => {
    const f = def.fields.find((x) => x.key === key)
    if (!f) return ''
    const v = values[key] ?? ''
    if (f.type === 'image' || f.type === 'link') return escapeHtml(safeUrl(v))
    if (f.type === 'color') return escapeHtml(safeColor(v, def.accent))
    return escapeHtml(v).replace(/\n/g, '<br>')
  })
  // </style> внутри CSS закрыл бы тег раньше времени
  const css = def.css.replace(/<\/style/gi, '<\\/style')
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${CSP}"><base target="_blank"><style>html,body{margin:0;font-family:Inter,system-ui,sans-serif;font-size:15px;color:#1c1917}${css}</style></head><body>${html}</body></html>`
}

/** sandbox без allow-scripts/allow-same-origin: шаблон не выполнит JS и не достанет cookies сайта */
// без allow-popups-to-escape-sandbox: открытая из блока вкладка остаётся в песочнице
export const CODE_SANDBOX = 'allow-popups'

/** Готовые заготовки для конструктора */
export function templates(): BlockDef[] {
  const now = new Date().toISOString()
  return [
    normalizeDef({
      name: 'Заметка',
      icon: '💡',
      description: 'Иконка и текст с цветной полосой',
      mode: 'visual',
      preset: 'callout',
      accent: '#3b82f6',
      fields: [
        { key: 'icon', label: 'Иконка', type: 'text', default: '💡' },
        { key: 'text', label: 'Текст', type: 'textarea', default: 'Текст заметки…' },
        { key: 'tone', label: 'Цвет', type: 'color', default: '#3b82f6' },
      ],
      updatedAt: now,
    }),
    normalizeDef({
      name: 'Карточка ссылки',
      icon: '🔗',
      description: 'Картинка, заголовок, описание и ссылка',
      mode: 'visual',
      preset: 'card',
      fields: [
        { key: 'image', label: 'Картинка', type: 'image', default: 'https://picsum.photos/seed/card/1200/600' },
        { key: 'title', label: 'Заголовок', type: 'text', default: 'Заголовок карточки' },
        { key: 'text', label: 'Описание', type: 'textarea', default: 'Пара строк о том, что по ссылке.' },
        { key: 'url', label: 'Ссылка', type: 'link', default: SITE_URL },
      ],
      updatedAt: now,
    }),
    normalizeDef({
      name: 'Свой HTML',
      icon: '</>',
      description: 'HTML/CSS-шаблон с полями {{title}} и {{text}}',
      mode: 'code',
      fields: [
        { key: 'title', label: 'Заголовок', type: 'text', default: 'Привет!' },
        { key: 'text', label: 'Текст', type: 'textarea', default: 'Это блок из моего шаблона.' },
      ],
      template: '<div class="box">\n  <h3>{{title}}</h3>\n  <p>{{text}}</p>\n</div>',
      css: '.box { padding: 16px; border-radius: 12px; background: linear-gradient(135deg,#fde68a,#fca5a5); }\nh3 { margin: 0 0 6px; }',
      height: 140,
      updatedAt: now,
    }),
  ]
}
