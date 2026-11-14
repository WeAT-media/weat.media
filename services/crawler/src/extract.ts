import * as cheerio from 'cheerio'
import type { AnyNode } from 'domhandler'
import TurndownService from 'turndown'

/** Статья, извлечённая со страницы источника */
export interface Extracted {
  url: string
  site: string
  title: string
  author: string | null
  authorUrl: string | null
  publishedAt: string | null
  tags: string[]
  lang: string | null
  cover: string | null
  excerpt: string
  markdown: string
}

export class ExtractError extends Error {}

const clean = (s: string | undefined | null) => (s ?? '').replace(/\s+/g, ' ').trim()

function absolutize($: cheerio.CheerioAPI, root: cheerio.Cheerio<AnyNode>, base: string) {
  const fix = (v: string | undefined) => {
    if (!v) return null
    try {
      const u = new URL(v, base)
      return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null
    } catch {
      return null
    }
  }
  root.find('a[href]').each((_, el) => {
    const v = fix($(el).attr('href'))
    if (v) $(el).attr('href', v)
    else $(el).removeAttr('href')
  })
  root.find('img').each((_, el) => {
    // ленивые картинки: настоящий адрес в data-src
    const v = fix($(el).attr('data-src') ?? $(el).attr('src'))
    if (v) $(el).attr('src', v)
    else $(el).remove()
  })
}

function sanitize(root: cheerio.Cheerio<AnyNode>) {
  root.find('script, style, noscript, iframe, object, embed, form, button, input, svg, link, meta').remove()
}

const turndown = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-' })
// язык блока кода из class="language-xxx" / data-lang
turndown.addRule('fencedWithLang', {
  filter: (node) => node.nodeName === 'PRE',
  replacement: (_content, node) => {
    const el = node as unknown as { textContent: string; querySelector: (s: string) => { getAttribute: (a: string) => string | null } | null; getAttribute: (a: string) => string | null }
    const code = el.querySelector('code')
    const cls = code?.getAttribute('class') ?? el.getAttribute('class') ?? ''
    const lang = /language-([\w+-]+)/.exec(cls)?.[1] ?? code?.getAttribute('data-lang') ?? ''
    return `\n\n\`\`\`${lang}\n${el.textContent.replace(/\n$/, '')}\n\`\`\`\n\n`
  },
})

// текст страницы может содержать «сырой» HTML (`<img onerror>` как текст): экранируем < и >,
// чтобы в опубликованный markdown не попала ни одна живая HTML-разметка
const baseEscape = turndown.escape.bind(turndown)
turndown.escape = (s: string) => baseEscape(s).replace(/</g, '&lt;').replace(/>/g, '&gt;')

function toMarkdown(html: string) {
  return turndown.turndown(html).replace(/\n{3,}/g, '\n\n').trim()
}

function firstParagraph(md: string): string {
  const para = md.split(/\n{2,}/).find((p) => p.trim() && !/^(#|!\[|```|>|- |\d+\. )/.test(p.trim()))
  return clean(para?.replace(/[*_`[\]]|\(https?:[^)]*\)/g, '')).slice(0, 400)
}

const meta = ($: cheerio.CheerioAPI, ...names: string[]) => {
  for (const n of names) {
    const v = $(`meta[property="${n}"], meta[name="${n}"]`).attr('content')
    if (clean(v)) return clean(v)
  }
  return null
}

const isoOrNull = (v: string | null | undefined) => {
  if (!v) return null
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

/** Habr: разметка проверена на habr.com/ru/articles/… (h1.tm-title, .article-formatted-body) */
function extractHabr($: cheerio.CheerioAPI, url: string): Extracted {
  const title = clean($('h1.tm-title').first().text())
  const body = $('.article-formatted-body').first()
  if (!title || body.length === 0) throw new ExtractError('Не нашёл заголовок или текст статьи на странице Habr')
  sanitize(body)
  absolutize($, body, url)
  const markdown = toMarkdown(body.html() ?? '')
  const authorEl = $('.tm-user-info__username').first()
  const authorHref = authorEl.closest('a').attr('href') ?? authorEl.attr('href')
  const tags = [
    ...new Set(
      $('.tm-publication-hub__link span, .tm-tags-list__link span, .tm-publication-hub__link')
        .map((_, el) => clean($(el).text()).replace(/\*$/, '').trim())
        .get()
        .filter((t) => t && t.length <= 64),
    ),
  ].slice(0, 10)
  return {
    url,
    site: 'habr.com',
    title,
    author: clean(authorEl.text()) || meta($, 'article:author', 'author'),
    authorUrl: authorHref ? new URL(authorHref, url).toString() : null,
    publishedAt: isoOrNull($('.tm-article-datetime-published time, time[datetime]').first().attr('datetime')),
    tags,
    lang: $('h1.tm-title').attr('lang') ?? $('html').attr('lang') ?? 'ru',
    cover: meta($, 'og:image'),
    excerpt: meta($, 'og:description')?.slice(0, 400) ?? firstParagraph(markdown),
    markdown,
  }
}

/** OpenNet: вёрстка таблицами, без og:title; текст новости — #r_memo, дата — «12.11.2026 22:10 (MSK)» */
function extractOpennet($: cheerio.CheerioAPI, url: string): Extracted {
  const title = clean($('#r_title').first().text()) || clean($('title').text())
  const body = $('#r_memo').first()
  if (!title || body.length === 0) throw new ExtractError('Не нашёл заголовок или текст новости на странице OpenNet')
  sanitize(body)
  absolutize($, body, url)
  const markdown = toMarkdown(body.html() ?? '')
  const d = /(\d{2})\.(\d{2})\.(\d{4})\D+(\d{2}):(\d{2})\s*\(MSK\)/.exec($('#r_title').closest('td').text())
  return {
    url,
    site: 'opennet.ru',
    title,
    author: null,
    authorUrl: null,
    publishedAt: d ? new Date(`${d[3]}-${d[2]}-${d[1]}T${d[4]}:${d[5]}:00+03:00`).toISOString() : null,
    tags: [],
    lang: 'ru',
    cover: meta($, 'og:image'),
    excerpt: meta($, 'og:description')?.trim().slice(0, 400) ?? firstParagraph(markdown),
    markdown,
  }
}

/** Любой сайт: og-метаданные + самый «текстовый» из article/main/body */
function extractGeneric($: cheerio.CheerioAPI, url: string): Extracted {
  // || а не ??: пустой h1 — это '' и должен уступить <title>
  const title = meta($, 'og:title', 'twitter:title') || clean($('h1').first().text()) || clean($('title').text())
  const candidates = ['article', '[itemprop="articleBody"]', 'main', '.post-content', '.entry-content', 'body']
  let body: cheerio.Cheerio<AnyNode> | null = null
  let best = 0
  for (const sel of candidates) {
    $(sel).each((_, el) => {
      const len = clean($(el).text()).length
      if (len > best) {
        best = len
        body = $(el)
      }
    })
    if (body && best > 500) break
  }
  if (!title || !body || best < 200) throw new ExtractError('Не удалось выделить текст статьи на этой странице')
  const root = body as cheerio.Cheerio<AnyNode>
  sanitize(root)
  root.find('nav, header, footer, aside').remove()
  absolutize($, root, url)
  const markdown = toMarkdown(root.html() ?? '')
  return {
    url,
    site: new URL(url).hostname.replace(/^www\./, ''),
    title,
    author: meta($, 'article:author', 'author', 'twitter:creator'),
    authorUrl: null,
    publishedAt: isoOrNull(meta($, 'article:published_time') ?? $('time[datetime]').first().attr('datetime')),
    tags: $('meta[property="article:tag"]').map((_, el) => clean($(el).attr('content'))).get().filter(Boolean).slice(0, 10),
    lang: $('html').attr('lang')?.slice(0, 2) ?? null,
    cover: meta($, 'og:image'),
    excerpt: meta($, 'og:description', 'description')?.slice(0, 400) ?? firstParagraph(markdown),
    markdown,
  }
}

/** фрагмент HTML (body из правил сайта) → markdown: та же очистка и абсолютные ссылки, что у встроенных разборщиков */
export function htmlToMarkdown(fragment: string, base: string): string {
  const $ = cheerio.load(`<div id="weat-root">${fragment}</div>`)
  const root = $('#weat-root') as cheerio.Cheerio<AnyNode>
  sanitize(root)
  absolutize($, root, base)
  return toMarkdown(root.html() ?? '')
}

/**
 * rules — правила разбора этого сайта (rules.ts, как Instant View); подошли — по ним,
 * иначе встроенный разборщик (habr, opennet) или общий
 */
export function extractArticle(html: string, url: string, rules?: (html: string, url: string) => Extracted | null): Extracted {
  const byRules = rules?.(html, url)
  if (byRules) {
    if (byRules.markdown.length < 100) throw new ExtractError('Правила сайта: текст статьи слишком короткий')
    return { ...byRules, markdown: byRules.markdown.slice(0, 200_000) }
  }
  const $ = cheerio.load(html)
  const host = new URL(url).hostname.replace(/^www\./, '')
  const out = host === 'habr.com' ? extractHabr($, url) : host === 'opennet.ru' ? extractOpennet($, url) : extractGeneric($, url)
  if (out.markdown.length < 100) throw new ExtractError('Текст статьи слишком короткий — похоже, это не статья')
  return { ...out, markdown: out.markdown.slice(0, 200_000) }
}

/** Ссылки на статьи из RSS/Atom */
export function rssLinks(xml: string): { url: string; title: string }[] {
  const $ = cheerio.load(xml, { xml: true })
  const items = $('item')
    .map((_, el) => ({ url: clean($(el).find('guid[isPermaLink="true"]').text()) || clean($(el).find('link').text()), title: clean($(el).find('title').text()) }))
    .get()
  const entries = $('entry')
    .map((_, el) => ({ url: $(el).find('link[rel="alternate"], link').first().attr('href') ?? '', title: clean($(el).find('title').text()) }))
    .get()
  return [...items, ...entries].filter((x) => /^https?:\/\//.test(x.url))
}
