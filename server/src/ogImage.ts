import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { Resvg } from '@resvg/resvg-js'
import satori from 'satori'
import { readBodyLimited, safeFetch, type SafeFetch } from './safeFetch.js'

/**
 * Картинка превью статьи (1200×630) для соцсетей и мессенджеров: название статьи, автор с фото.
 * Палитра и шрифты — как у общей public/og-image.png (scripts/og-image.py). Рендер: satori (разметка → SVG)
 * и resvg (SVG → PNG), без браузера.
 */

const require = createRequire(import.meta.url)
const font = (pkg: string, file: string) => readFileSync(require.resolve(`@fontsource/${pkg}/files/${file}`))

type Weight = 500 | 700 | 800
let fonts: { name: string; data: Buffer; weight: Weight; style: 'normal' }[] | null = null
const loadFonts = () =>
  // подмножества latin/cyrillic — разные имена: одноимённые satori не перебирает при нехватке глифа
  (fonts ??= [
    ...(['latin', 'cyrillic'] as const).flatMap((sub) => [
      { name: `Inter-${sub}`, data: font('inter', `inter-${sub}-500-normal.woff`), weight: 500 as Weight, style: 'normal' as const },
      { name: `Inter-${sub}`, data: font('inter', `inter-${sub}-800-normal.woff`), weight: 800 as Weight, style: 'normal' as const },
      { name: `JBMono-${sub}`, data: font('jetbrains-mono', `jetbrains-mono-${sub}-700-normal.woff`), weight: 700 as Weight, style: 'normal' as const },
    ]),
  ])

const BG = '#faf6f3'
const FG = '#3c3835'
const ACC = '#bc773f'
const MUTED = '#6e675f'
const LINE = '#dec9b8'

type Node = { type: string; props: Record<string, unknown> & { children?: unknown } }
const h = (type: string, style: Record<string, unknown>, ...children: unknown[]): Node => ({
  type,
  props: { style: { display: 'flex', ...style }, children: children.length === 1 ? children[0] : children },
})

export interface ArticleCard {
  title: string
  author: string
  handle?: string | null
  /** статья краулера: сайт оригинала вместо handle (без «@») */
  site?: string | null
  /** теги статьи — чипами под заголовком (до 4) */
  tags?: string[]
  /** data: URI фото автора (png/jpeg) */
  avatar?: string | null
  siteName: string
}

const clamp = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s)

export async function renderArticleCard(a: ArticleCard): Promise<Buffer> {
  const title = clamp(a.title.trim(), 140)
  const tags = [...new Set((a.tags ?? []).map((t) => t.trim().replace(/^#/, '')).filter(Boolean))].slice(0, 4)
  // с тегами заголовку на строку меньше места
  const size = title.length <= 40 ? 76 : title.length <= 80 ? (tags.length ? 56 : 62) : tags.length ? 44 : 50
  const initial = (a.author.trim()[0] ?? '?').toUpperCase()

  // «атмосфера»: концентрические дуги справа внизу, как на общей картинке
  const arcs = [140, 225, 310, 395, 480, 565, 650].map((r, i) =>
    h('div', { position: 'absolute', left: 1080 - r, top: 560 - r, width: r * 2, height: r * 2, borderRadius: r, border: `${i % 2 === 0 ? 3 : 2}px solid ${LINE}` }),
  )

  const avatar = a.avatar
    ? { type: 'img', props: { src: a.avatar, width: 84, height: 84, style: { borderRadius: 42, border: `3px solid ${LINE}`, objectFit: 'cover' } } }
    : h('div', { width: 84, height: 84, borderRadius: 42, background: ACC, color: BG, alignItems: 'center', justifyContent: 'center', fontSize: 40, fontWeight: 800 }, initial)

  const tree = h(
    'div',
    { width: 1200, height: 630, background: BG, position: 'relative', fontFamily: 'Inter-latin, Inter-cyrillic', color: FG, overflow: 'hidden' },
    ...arcs,
    h('div', { position: 'absolute', left: 0, top: 0, width: 10, height: 630, background: ACC }),
    h(
      'div',
      { position: 'absolute', left: 84, top: 72, right: 220, bottom: 64, flexDirection: 'column', justifyContent: 'space-between' },
      h(
        'div',
        { flexDirection: 'column' },
        h('div', { fontFamily: 'JBMono-latin, JBMono-cyrillic', fontWeight: 700, fontSize: 22, letterSpacing: 1, color: ACC }, `${a.siteName} · статья`),
        h('div', { marginTop: 28, fontSize: size, fontWeight: 800, lineHeight: 1.12, letterSpacing: -1 }, title),
        ...(tags.length
          ? [
              h(
                'div',
                { marginTop: 26, flexWrap: 'wrap', gap: 12 },
                ...tags.map((t) =>
                  h('div', { fontFamily: 'JBMono-latin, JBMono-cyrillic', fontWeight: 700, fontSize: 20, color: FG, background: BG, border: `2px solid ${LINE}`, borderRadius: 22, padding: '8px 18px' }, `#${clamp(t, 28)}`),
                ),
              ),
            ]
          : []),
      ),
      h(
        'div',
        { alignItems: 'center' },
        avatar,
        h(
          'div',
          { flexDirection: 'column', marginLeft: 22 },
          h('div', { fontSize: 32, fontWeight: 800 }, clamp(a.author, 40)),
          ...(a.handle || a.site ? [h('div', { marginTop: 4, fontSize: 24, fontWeight: 500, color: MUTED }, a.handle ? `@${clamp(a.handle, 48)}` : `с ${clamp(a.site!, 48)}`)] : []),
        ),
      ),
    ),
  )

  const svg = await satori(tree as never, { width: 1200, height: 630, fonts: loadFonts() })
  return new Resvg(svg, { fitTo: { mode: 'width', value: 1200 } }).render().asPng()
}

/** фото автора → data: URI для satori (png/jpeg; webp и прочее satori не рисует — тогда буква) */
export async function avatarDataUri(url: string, fetcher: SafeFetch = safeFetch): Promise<string | null> {
  const res = await fetcher(url, { signal: AbortSignal.timeout(4000) }).catch(() => null)
  if (!res?.ok) return null
  const buf = await readBodyLimited(res, 2_000_000).catch(() => null)
  if (!buf) return null
  const type = buf[0] === 0x89 && buf[1] === 0x50 ? 'image/png' : buf[0] === 0xff && buf[1] === 0xd8 ? 'image/jpeg' : null
  return type ? `data:${type};base64,${buf.toString('base64')}` : null
}
