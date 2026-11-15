import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { ArrowLeft, Check, Copy, Download } from 'lucide-react'
import Reveal from '@/components/Reveal'
import Stamp from '@/components/Stamp'
import BrandName from '@/components/BrandName'
import WheatMark from '@/components/WheatMark'
import { SITE_NAME } from '@/config/site'

/** Токены из src/index.css: значения читаются из живой темы, поэтому в тёмной теме видны тёмные */
const COLOR_TOKENS = [
  { name: 'background', role: 'Фон страницы — тёплая бумага' },
  { name: 'foreground', role: 'Основной текст — уголь' },
  { name: 'card', role: 'Подложка блоков, вторичные кнопки' },
  { name: 'muted', role: 'Тихие плашки' },
  { name: 'muted-foreground', role: 'Метаданные, подписи' },
  { name: 'accent', role: 'Терракота: «AT» в названии, ссылки при наведении, зёрна колоса' },
  { name: 'primary', role: 'Главная кнопка, футер' },
  { name: 'border', role: 'Линии-разделители вместо карточек' },
  { name: 'destructive', role: 'Опасные действия' },
] as const

/** Варианты акцента из настроек «Внешний вид» */
const ACCENTS = [
  { name: 'terracotta', label: 'Терракота (по умолчанию)', hsl: '27 50% 49%' },
  { name: 'forest', label: 'Лес', hsl: '145 40% 36%' },
  { name: 'indigo', label: 'Индиго', hsl: '235 45% 50%' },
  { name: 'crimson', label: 'Кармин', hsl: '350 55% 44%' },
]

const TYPE_SCALE = [
  { label: 'Display · H1', cls: 'text-4xl font-extrabold tracking-tight md:text-5xl', spec: 'Inter 800 · 36/48 px · tracking −0.025em', sample: 'Свободная пресса' },
  { label: 'H2', cls: 'text-2xl font-extrabold tracking-tight', spec: 'Inter 800 · 24 px', sample: 'Заголовок раздела' },
  { label: 'H3', cls: 'text-lg font-semibold', spec: 'Inter 600 · 18 px', sample: 'Подзаголовок' },
  { label: 'Body', cls: 'text-base', spec: 'Inter 400 · 16 px · line-height 1.65', sample: 'Записи живут в репозиториях авторов, площадка лишь собирает ленту.' },
  { label: 'Small', cls: 'text-sm text-muted-foreground', spec: 'Inter 400 · 14 px · muted', sample: 'Пояснение под полем или карточкой.' },
  { label: 'Meta', cls: 'meta', spec: 'JetBrains Mono 400 · 12 px · UPPERCASE · tracking 0.08em', sample: '13 ноября 2026 · 5 мин' },
  { label: 'Code', cls: 'font-mono text-[13px]', spec: 'JetBrains Mono 400 · 13 px', sample: 'at://did:plc:…/media.weat.article/3k' },
]

function hslToHex(hsl: string): string {
  const [h = 0, s = 0, l = 0] = hsl.replace(/%/g, '').split(/\s+/).map(Number)
  const a = (s / 100) * Math.min(l / 100, 1 - l / 100)
  const f = (n: number) => {
    const k = (n + h / 30) % 12
    const c = l / 100 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))
    return Math.round(c * 255).toString(16).padStart(2, '0')
  }
  return `#${f(0)}${f(8)}${f(4)}`
}

/** значения CSS-переменных текущей темы; обновляются при переключении светлой/тёмной */
function useTokens(names: readonly string[]) {
  const read = () => {
    const css = getComputedStyle(document.documentElement)
    return Object.fromEntries(names.map((n) => [n, css.getPropertyValue(`--${n}`).trim()]))
  }
  const [values, setValues] = useState<Record<string, string>>(read)
  useEffect(() => {
    const obs = new MutationObserver(() => setValues(read()))
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-accent'] })
    return () => obs.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return values
}

function CopyButton({ text, label, display }: { text: string; label: string; display?: string }) {
  const [done, setDone] = useState(false)
  return (
    <button
      type="button"
      onClick={() =>
        navigator.clipboard?.writeText(text).then(() => {
          setDone(true)
          setTimeout(() => setDone(false), 1500)
        }, () => {})
      }
      className="inline-flex cursor-pointer items-center gap-1 font-mono text-[11px] text-muted-foreground transition-colors hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      aria-label={`Скопировать ${label}`}
    >
      {done ? <Check size={11} aria-hidden="true" /> : <Copy size={11} aria-hidden="true" />}
      {display ?? text}
    </button>
  )
}

function Section({ id, title, lead, children }: { id: string; title: string; lead: string; children: React.ReactNode }) {
  return (
    <Reveal>
      <section id={id} className="rule scroll-mt-24 py-12">
        <h2 className="text-2xl font-extrabold tracking-tight">{title}</h2>
        <p className="mt-2 max-w-[64ch] text-[15px] leading-relaxed text-muted-foreground">{lead}</p>
        <div className="mt-8">{children}</div>
      </section>
    </Reveal>
  )
}

/** Дизайнерам: знак, цвета, типографика и компоненты — чтобы делать совместимые с площадкой материалы и клиенты */
export default function DesignPage() {
  const tokens = useTokens(COLOR_TOKENS.map((t) => t.name))
  const css = `:root {\n${COLOR_TOKENS.map((t) => `  --${t.name}: ${tokens[t.name]};`).join('\n')}\n  --radius: 0.375rem;\n}\n/* использование: color: hsl(var(--accent)); */`

  return (
    <div className="mx-auto max-w-[960px] px-5 pb-24 md:px-8">
      <div className="pt-10">
        <Link
          to="/feed"
          className="inline-flex items-center gap-2 font-mono text-[12px] font-semibold uppercase tracking-[0.08em] text-muted-foreground transition-colors hover:text-accent"
        >
          <ArrowLeft size={13} aria-hidden="true" /> Лента
        </Link>
        <p className="meta mt-8">Дизайн-код · открыт для всех</p>
        <h1 className="mt-2 text-4xl font-extrabold tracking-tight md:text-5xl">Дизайнерам</h1>
        <p className="mt-4 max-w-[64ch] text-[15px] leading-relaxed text-muted-foreground">
          Знак, маскот, цвета, шрифты и базовые компоненты {SITE_NAME}. Берите их для своих клиентов AT Protocol, виджетов,
          обложек и материалов о площадке. Значения ниже — из живой темы: переключите тёмную тему, и они обновятся.
        </p>
        <nav aria-label="Разделы" className="mt-6 flex flex-wrap gap-2">
          {[['logo', 'Знак'], ['mascot', 'Маскот'], ['colors', 'Цвета'], ['type', 'Типографика'], ['components', 'Компоненты'], ['tokens', 'Токены']].map(([id, label]) => (
            <a key={id} href={`#${id}`} className="btn-ghost !px-3 !py-1 !text-[11px]">{label}</a>
          ))}
        </nav>
      </div>

      <div className="mt-10">
        <Section id="logo" title="Знак" lead="Колос пшеницы: weat — «we AT», мы в AT Protocol. Зёрна — акцентом, стебель — цветом текста. Вокруг знака оставляйте поле не меньше половины его ширины; не поворачивайте и не перекрашивайте зёрна в другие цвета, кроме вариантов акцента.">
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="flex aspect-square items-center justify-center rounded-lg border border-border bg-background">
              <WheatMark className="h-24 w-24" />
            </div>
            <div className="flex aspect-square items-center justify-center rounded-lg bg-primary">
              <img src="/favicon.svg" alt="Иконка приложения" className="h-24 w-24" />
            </div>
            <div className="flex aspect-square flex-col items-center justify-center gap-3 rounded-lg border border-border bg-card">
              <span className="flex items-center gap-2.5 text-[28px] font-extrabold tracking-tight">
                <WheatMark className="h-8 w-8" />
                <BrandName />
              </span>
              <span className="meta">Знак + название</span>
            </div>
          </div>
          <div className="mt-6 flex flex-wrap gap-3">
            <a href="/favicon.svg" download className="btn-primary"><Download size={14} aria-hidden="true" /> SVG</a>
            <a href="/icon-512.png" download className="btn-ghost"><Download size={14} aria-hidden="true" /> PNG 512</a>
            <a href="/apple-touch-icon.png" download className="btn-ghost"><Download size={14} aria-hidden="true" /> PNG 180</a>
          </div>
          <p className="mt-4 text-sm text-muted-foreground">
            В названии «AT» всегда выделено акцентом и пишется заглавными: <BrandName className="font-semibold text-foreground" />.
          </p>
        </Section>

        <Section id="mascot" title="АТик — маскот" lead="Зерно свободного слова с ростком-колосом. Используйте маскота в коммуникациях и сувенирной продукции; для интерфейсных иконок и маленьких размеров оставляйте основной знак. Не меняйте пропорции, выражение лица и фирменные цвета.">
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="flex aspect-square items-center justify-center rounded-lg border border-border bg-[#fffdfa] p-8">
              <img src="/brand/weat-mascot.svg" alt="АТик, цветная версия" className="h-full w-full" />
            </div>
            <div className="flex aspect-square items-center justify-center rounded-lg border border-border bg-[#fffdfa] p-8">
              <img src="/brand/weat-mascot-mono.svg" alt="АТик, одноцветная версия" className="h-full w-full" />
            </div>
            <div className="flex aspect-square items-center justify-center rounded-lg bg-[#211e1b] p-8">
              <img src="/brand/weat-mascot-reverse.svg" alt="АТик, выворотная версия" className="h-full w-full" />
            </div>
          </div>
          <div className="mt-6 flex flex-wrap gap-3">
            <a href="/brand/weat-mascot-guide.pdf" download className="btn-primary"><Download size={14} aria-hidden="true" /> Гайд для печати · PDF</a>
            <a href="/brand/weat-mascot.svg" download className="btn-ghost"><Download size={14} aria-hidden="true" /> SVG</a>
            <a href="/brand/weat-mascot.png" download className="btn-ghost"><Download size={14} aria-hidden="true" /> PNG 800</a>
          </div>
          <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
            <a href="/brand/weat-mascot-mono.svg" download className="text-accent underline underline-offset-4">Одноцветный SVG</a>
            {' · '}
            <a href="/brand/weat-mascot-reverse.svg" download className="text-accent underline underline-offset-4">Выворотный SVG</a>
            {' · '}
            <a href="/brand/weat-mascot-guide.html" target="_blank" rel="noreferrer" className="text-accent underline underline-offset-4">Версия гайда для браузера</a>.
            Минимальная высота в печати: 20 мм для цветной версии, 15 мм для одноцветной.
          </p>
        </Section>

        <Section id="colors" title="Цвета" lead="Тёплая «бумажная» палитра. Цвета заданы HSL-тройками в CSS-переменных; в Tailwind — классы bg-*, text-*, border-* с теми же именами.">
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {COLOR_TOKENS.map((t) => {
              const v = tokens[t.name] ?? ''
              return (
                <li key={t.name} className="overflow-hidden rounded-lg border border-border">
                  <div className="h-20" style={{ background: `hsl(${v})` }} />
                  <div className="space-y-1 p-3">
                    <p className="font-semibold">{t.name}</p>
                    <p className="text-[13px] leading-snug text-muted-foreground">{t.role}</p>
                    <div className="flex flex-col items-start gap-0.5 pt-1">
                      <CopyButton text={hslToHex(v)} label={`HEX ${t.name}`} />
                      <CopyButton text={`hsl(${v})`} label={`HSL ${t.name}`} />
                      <CopyButton text={`var(--${t.name})`} label={`переменную ${t.name}`} />
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
          <h3 className="mt-10 text-lg font-semibold">Варианты акцента</h3>
          <p className="mt-1 text-sm text-muted-foreground">Читатель выбирает в настройках; атрибут <code>data-accent</code> на &lt;html&gt;.</p>
          <ul className="mt-4 flex flex-wrap gap-4">
            {ACCENTS.map((a) => (
              <li key={a.name} className="flex items-center gap-3">
                <span className="h-10 w-10 rounded-full" style={{ background: `hsl(${a.hsl})` }} />
                <span>
                  <span className="block text-sm font-semibold">{a.label}</span>
                  <CopyButton text={hslToHex(a.hsl)} label={`HEX ${a.label}`} />
                </span>
              </li>
            ))}
          </ul>
        </Section>

        <Section id="type" title="Типографика" lead="Два шрифта, оба под лицензией OFL: Inter — для текста и заголовков, JetBrains Mono — для метаданных, кода и кнопок. Подключение — Google Fonts.">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-lg border border-border p-5">
              <p className="meta">Основной</p>
              <p className="mt-2 text-5xl font-extrabold tracking-tight">Inter</p>
              <p className="mt-2 text-sm text-muted-foreground">400 · 500 · 600 · 800</p>
              <p className="mt-3 text-[15px]">Аа Бб Вв Gg 0123456789</p>
            </div>
            <div className="rounded-lg border border-border p-5">
              <p className="meta">Моноширинный</p>
              <p className="mt-2 font-mono text-4xl font-bold">JetBrains Mono</p>
              <p className="mt-2 text-sm text-muted-foreground">400 · 600 · 700 · 400 italic</p>
              <p className="mt-3 font-mono text-[14px]">Аа Бб {'{ }'} =&gt; 0O 1l</p>
            </div>
          </div>
          <ul className="mt-8">
            {TYPE_SCALE.map((t) => (
              <li key={t.label} className="rule grid gap-2 py-5 md:grid-cols-[180px_1fr]">
                <div>
                  <p className="font-mono text-[12px] font-semibold">{t.label}</p>
                  <p className="mt-1 text-[12px] leading-snug text-muted-foreground">{t.spec}</p>
                </div>
                <p className={t.cls}>{t.sample}</p>
              </li>
            ))}
          </ul>
          <div className="mt-4">
            <CopyButton
              text="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;800&family=JetBrains+Mono:ital,wght@0,400;0,600;0,700;1,400&display=swap"
              label="ссылку на шрифты"
              display="Скопировать ссылку Google Fonts"
            />
          </div>
        </Section>

        <Section id="components" title="Компоненты" lead="Кнопки-пилюли с моноширинной подписью, линии вместо карточек, штампы вердиктов. Одна первичная кнопка на экран.">
          <div className="flex flex-wrap items-center gap-4">
            <button type="button" className="btn-primary">Опубликовать</button>
            <button type="button" className="btn-ghost">Отмена</button>
            <span className="meta">.btn-primary · .btn-ghost</span>
          </div>
          <div className="mt-8 flex flex-wrap items-center gap-6">
            <Stamp verdict="acquitted" />
            <Stamp verdict="guilty" />
            <Stamp verdict="trial" />
            <span className="meta">.stamp</span>
          </div>
          <div className="mt-8">
            <div className="rule pt-4">
              <p className="meta">13 ноября 2026</p>
              <p className="mt-1 text-xl font-extrabold tracking-tight">Карточка ленты — это линия, а не рамка</p>
            </div>
            <p className="meta mt-3">.rule · .meta</p>
          </div>
          <div className="mt-8 flex flex-wrap items-end gap-4">
            {[['sm', 'calc(var(--radius) - 4px)'], ['md', 'calc(var(--radius) - 2px)'], ['lg', 'var(--radius)'], ['xl', 'calc(var(--radius) + 4px)'], ['full', '9999px']].map(([n, r]) => (
              <div key={n} className="text-center">
                <div className="h-14 w-14 border-2 border-accent bg-card" style={{ borderRadius: r }} />
                <p className="meta mt-2">{n}</p>
              </div>
            ))}
            <span className="meta">радиусы · база 6 px</span>
          </div>
        </Section>

        <Section id="tokens" title="Токены" lead="Переменные текущей темы одним блоком — вставьте в свой CSS. Исходник: src/index.css и tailwind.config.js в репозитории (AGPL-3.0).">
          <div className="relative">
            <pre className="overflow-x-auto rounded-lg bg-primary p-5 text-[13px] leading-relaxed text-primary-foreground">{css}</pre>
            <div className="mt-3">
              <CopyButtonBlock text={css} />
            </div>
          </div>
        </Section>
      </div>
    </div>
  )
}

function CopyButtonBlock({ text }: { text: string }) {
  const [done, setDone] = useState(false)
  return (
    <button
      type="button"
      className="btn-ghost"
      onClick={() => navigator.clipboard?.writeText(text).then(() => setDone(true), () => {})}
    >
      {done ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
      {done ? 'Скопировано' : 'Скопировать CSS'}
    </button>
  )
}
