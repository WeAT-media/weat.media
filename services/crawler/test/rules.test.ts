import { test } from 'node:test'
import assert from 'node:assert/strict'
import { extractByRules, parseRules, RulesError } from '../src/rules.ts'
import { extractArticle } from '../src/extract.ts'

const RULES = `~version: "2.0"

title: //header/h1[1]
cover: //header/img[1]
body:     //article[contains(@class, 'prose')]

?path: /blog/.+

channel: "haradkou_sdet"`

const PAGE = `<html lang="ru"><head><title>t</title></head><body>
<header><h1>AJV и TypeScript</h1><img src="/img/cover.png"></header>
<article class="prose lg">
  <p>Первый абзац статьи про ajv-ts, достаточно длинный, чтобы пройти минимальную длину текста статьи.</p>
  <div class="ads">РЕКЛАМА</div>
  <pre><code class="language-ts">const x = 1</code></pre>
  <script>alert(1)</script>
  <a href="/blog/12">дальше</a>
</article></body></html>`

test('rules: Instant View example — title, cover, body; relative links absolute; scripts dropped', () => {
  const a = extractByRules(RULES, PAGE, 'https://blog-vitaliharadkou.vercel.app/blog/11-ajv-ts/')!
  assert.equal(a.title, 'AJV и TypeScript')
  assert.equal(a.cover, 'https://blog-vitaliharadkou.vercel.app/img/cover.png')
  assert.match(a.markdown, /```ts\nconst x = 1\n```/)
  assert.match(a.markdown, /\(https:\/\/blog-vitaliharadkou\.vercel\.app\/blog\/12\)/)
  assert.ok(!a.markdown.includes('alert'))
  assert.equal(a.site, 'blog-vitaliharadkou.vercel.app')
})

test('rules: conditions — ?path not matching means rules do not apply (fallback to built-in)', () => {
  // все свойства в примере — до ?path, поэтому применяются всегда; правила под условием — нет
  const scoped = `?path: /blog/.+\ntitle: //header/h1`
  assert.equal(extractByRules(scoped, PAGE, 'https://x.dev/about'), null)
  assert.ok(extractByRules(scoped + '\nbody: //article', PAGE, 'https://x.dev/blog/1'))
})

test('rules: has-class, @remove, ! override, string values, errors with line numbers', () => {
  const src = `title: "Заголовок по умолчанию"\n!title: //h1\n@remove: //div[has-class("ads")]\nbody: //article[has-class("prose")]\nauthor: "Виталий"`
  const a = extractByRules(src, PAGE, 'https://x.dev/blog/1')!
  assert.equal(a.title, 'AJV и TypeScript', '! перезаписывает')
  assert.equal(a.author, 'Виталий')
  assert.ok(!a.markdown.includes('РЕКЛАМА'), '@remove вырезал')
  assert.throws(() => parseRules('title //h1'), (e: unknown) => e instanceof RulesError && e.line === 1)
  assert.throws(() => parseRules('ok: "x"\n?path: ([)'), (e: unknown) => e instanceof RulesError && e.line === 2)
  assert.throws(() => extractByRules('title: //h1[', PAGE, 'https://x.dev/'), /XPath/)
  assert.throws(() => extractByRules('title: //h1', PAGE, 'https://x.dev/'), /body/)
})

test('extractArticle uses site rules first, built-in otherwise', () => {
  const viaRules = extractArticle(PAGE, 'https://x.dev/blog/1', (h, u) => extractByRules(RULES, h, u))
  assert.equal(viaRules.title, 'AJV и TypeScript')
})
