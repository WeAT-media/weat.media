/**
 * Справка для /api: какой markdown понимает сайт в поле text статьи (POST /me/articles, /v1/articles,
 * PUT /me/pending). Тот же формат пишет редактор (BlockSuite) и читает страница статьи.
 */

const INLINE: [string, string][] = [
  ['**жирный** или __жирный__', 'жирный'],
  ['*курсив* или _курсив_', 'курсив'],
  ['~~зачёркнутый~~', 'зачёркнутый'],
  ['<u>подчёркнутый</u>', 'подчёркнутый'],
  ['`код`', 'код в строке'],
  ['[текст](https://weat.media)', 'ссылка (https://, http://, / — путь на сайте)'],
  ['![подпись](https://…/img.png)', 'картинка'],
  ['\\*не курсив\\*', 'экранирование: символ как есть'],
]

const BLOCKS: [string, string][] = [
  ['## Раздел  /  ### Подраздел', 'заголовки (попадают в оглавление). Строка «# …» в начале — заголовок статьи, его передают в title'],
  ['- пункт  /  1. пункт', 'списки'],
  ['> цитата', 'цитата'],
  ['```js\\nconsole.log(1)\\n```', 'блок кода с подсветкой по языку'],
  ['пустая строка', 'разделяет абзацы'],
]

const FENCES: { lang: string; what: string; json: string }[] = [
  { lang: 'faq', what: 'вопросы и ответы (раскрывающийся список)', json: '{"title":"Частые вопросы","items":[{"q":"Что такое weAT.media?","a":"Площадка для технических блогов."}]}' },
  { lang: 'button', what: 'кнопка-ссылка; url — https:// или путь на сайте, variant — primary | ghost', json: '{"label":"Попробовать","url":"https://weat.media/compose","variant":"primary","note":"бесплатно"}' },
  { lang: 'bookmark', what: 'карточка ссылки (как «/link» в редакторе)', json: '{"url":"https://atproto.com","title":"AT Protocol","description":"Открытый протокол","image":"https://…/cover.png"}' },
  { lang: 'poll', what: 'опрос; голосуют на странице статьи', json: '{"question":"Какой язык?","options":["Rust","Go","TypeScript"],"settings":{"multiple":false,"shuffle":false,"subscribersOnly":false,"authorizedOnly":true,"countries":[]}}' },
  { lang: 'callout', what: 'выноска; tone — info | success | warning | danger', json: '{"tone":"warning","icon":"⚠️","text":"Сначала сделайте резервную копию."}' },
  { lang: 'carousel', what: 'карусель картинок', json: '{"items":[{"url":"https://…/1.png","caption":"Схема"},{"url":"https://…/2.png"}]}' },
]

const code = 'rounded bg-secondary px-1.5 py-0.5 font-mono text-[12px]'

export default function ArticleFormatDocs() {
  return (
    <section id="article-format" aria-label="Формат текста статьи" className="scroll-mt-24">
      <h2 className="text-2xl font-extrabold tracking-tight">Формат текста статьи</h2>
      <p className="mt-1 max-w-[72ch] text-sm leading-relaxed text-muted-foreground">
        Поле <code className={code}>text</code> (POST /me/articles, POST /v1/articles, PUT /me/pending) — markdown. Тот же формат пишет
        редактор сайта и читает страница статьи: что отправили, то и увидит читатель. До 200 000 символов. Заголовок статьи — в
        <code className={code}>title</code>, не в тексте.
      </p>

      <h3 className="mt-6 font-mono text-[13px] font-bold uppercase tracking-[0.12em]">Блоки</h3>
      <dl className="mt-2 divide-y divide-border border-y border-border text-sm">
        {BLOCKS.map(([k, v]) => (
          <div key={k} className="grid gap-1 py-2 sm:grid-cols-[minmax(0,260px)_1fr] sm:gap-4">
            <dt><code className={code}>{k}</code></dt>
            <dd className="text-muted-foreground">{v}</dd>
          </div>
        ))}
      </dl>

      <h3 className="mt-6 font-mono text-[13px] font-bold uppercase tracking-[0.12em]">В строке</h3>
      <dl className="mt-2 divide-y divide-border border-y border-border text-sm">
        {INLINE.map(([k, v]) => (
          <div key={k} className="grid gap-1 py-2 sm:grid-cols-[minmax(0,260px)_1fr] sm:gap-4">
            <dt><code className={code}>{k}</code></dt>
            <dd className="text-muted-foreground">{v}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-2 text-sm text-muted-foreground">Выделение можно вкладывать: <code className={code}>**жирный с [ссылкой](https://…)**</code>. Небезопасные ссылки (javascript: и т. п.) показываются текстом.</p>

      <h3 className="mt-6 font-mono text-[13px] font-bold uppercase tracking-[0.12em]">Свои блоки</h3>
      <p className="mt-2 max-w-[72ch] text-sm leading-relaxed text-muted-foreground">
        Фенс с языком блока и JSON внутри. Битый JSON или пустой блок не показывается (а не выводится сырым текстом). В редакторе
        сайта свои блоки — функция Premium; через API их может отправить любой автор.
      </p>
      <div className="mt-3 space-y-3">
        {FENCES.map((f) => (
          <div key={f.lang} className="border border-border p-3">
            <p className="text-sm"><code className={code}>```{f.lang}</code> — {f.what}</p>
            <pre className="mt-2 overflow-x-auto rounded bg-secondary p-3 font-mono text-[12px] leading-relaxed">{`\`\`\`${f.lang}\n${f.json}\n\`\`\``}</pre>
          </div>
        ))}
      </div>

      <h3 className="mt-6 font-mono text-[13px] font-bold uppercase tracking-[0.12em]">Пример</h3>
      <pre className="mt-2 overflow-x-auto rounded bg-secondary p-3 font-mono text-[12px] leading-relaxed">{`curl -X POST https://weat.media/api/v1/articles \\
  -H "Authorization: Bearer wm_pat_…" -H "content-type: application/json" \\
  -d '{
    "title": "Зачем нам свой PDS",
    "tags": ["atproto"],
    "langs": ["ru"],
    "text": "## Коротко\\n\\nПосты не должны **пропадать**. Подробнее — [AT Protocol](https://atproto.com).\\n\\n\`\`\`bookmark\\n{\\"url\\":\\"https://atproto.com\\",\\"title\\":\\"AT Protocol\\"}\\n\`\`\`"
  }'`}</pre>
      <p className="mt-2 text-sm text-muted-foreground">
        С сайта (POST /me/articles) статья первые 24 ч в периоде охлаждения: видна только на weat.media, правится и удаляется
        через /me/pending, потом уходит в AT-репозиторий по тому же адресу. Токеном (/v1/articles) — сразу в репозиторий.
      </p>
    </section>
  )
}
