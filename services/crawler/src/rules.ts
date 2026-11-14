import { JSDOM } from 'jsdom'
import { ExtractError, type Extracted, htmlToMarkdown } from './extract.js'

/**
 * Правила разбора сайта — подмножество Telegram Instant View 2.0 (https://instantview.telegram.org/docs):
 *
 *   ~version: "2.0"
 *   ?path: /blog/.+               # условия: блок ниже применяется, если хотя бы одно условие подряд истинно
 *   title:  //header/h1[1]        # свойство: XPath (первый узел, текст) или "строка"
 *   cover:  //header/img[1]       # для картинки берётся src
 *   body:   //article[has-class("prose")]
 *   @remove: //div[has-class("ads")]   # вырезать узлы (до извлечения body)
 *   !author: //a[@rel="author"]   # «!» — перезаписать уже найденное значение
 *
 * Условия: ?path, ?domain (регулярное выражение), ?exists, ?not_exists (XPath). Свойство задаётся один раз —
 * первым подходящим правилом (как в IV). Неизвестные свойства (channel и т. п.) принимаются и игнорируются.
 * XPath 1.0 из jsdom плюс has-class("x") из IV.
 */

export const PROPERTIES = ['title', 'subtitle', 'author', 'author_url', 'published_date', 'cover', 'body', 'description', 'lang', 'tags'] as const
type Property = (typeof PROPERTIES)[number]

type Condition = { kind: 'path'; re: RegExp } | { kind: 'domain'; re: RegExp } | { kind: 'exists'; xpath: string } | { kind: 'not_exists'; xpath: string }
type Rule =
  | { kind: 'conditions'; list: Condition[]; line: number }
  | { kind: 'prop'; name: string; value: string; force: boolean; line: number }
  | { kind: 'remove'; xpath: string; line: number }

export class RulesError extends Error {
  constructor(
    readonly line: number,
    message: string,
  ) {
    super(`строка ${line}: ${message}`)
  }
}

/** has-class("x") из IV → чистый XPath 1.0 */
const expandXpath = (x: string) =>
  x.replace(/has-class\(\s*(["'])([^"']+)\1\s*\)/g, (_m, _q, cls: string) => `contains(concat(" ", normalize-space(@class), " "), " ${cls} ")`)

export function parseRules(src: string): Rule[] {
  const rules: Rule[] = []
  let pending: Condition[] | null = null
  src.split('\n').forEach((raw, i) => {
    const line = i + 1
    const text = raw.replace(/(^|\s)#.*$/, '').trim()
    if (!text || text.startsWith('~')) return
    const m = /^([?@!$]?[a-z_][a-z0-9_]*)\s*:\s*(.+)$/i.exec(text)
    if (!m) throw new RulesError(line, `не понял правило «${text.slice(0, 60)}»`)
    const [, key, value] = m as unknown as [string, string, string]
    if (key.startsWith('?')) {
      const name = key.slice(1)
      let c: Condition
      if (name === 'path' || name === 'domain') {
        try {
          const re = new RegExp(`^(?:${value.trim()})$`)
          c = name === 'path' ? { kind: 'path', re } : { kind: 'domain', re }
        } catch {
          throw new RulesError(line, `неверное регулярное выражение в ?${name}`)
        }
      } else if (name === 'exists') c = { kind: 'exists', xpath: expandXpath(value.trim()) }
      else if (name === 'not_exists') c = { kind: 'not_exists', xpath: expandXpath(value.trim()) }
      else throw new RulesError(line, `неизвестное условие ?${name}`)
      // условия подряд — одна группа (ИЛИ)
      if (pending) pending.push(c)
      else {
        pending = [c]
        rules.push({ kind: 'conditions', list: pending, line })
      }
      return
    }
    pending = null
    if (key === '@remove') return void rules.push({ kind: 'remove', xpath: expandXpath(value.trim()), line })
    if (key.startsWith('@') || key.startsWith('$')) throw new RulesError(line, `функция ${key} пока не поддерживается (есть @remove)`)
    const force = key.startsWith('!')
    rules.push({ kind: 'prop', name: force ? key.slice(1) : key, value: value.trim(), force, line })
  })
  return rules
}

const STRING = /^"(.*)"$/

export interface RuleResult {
  /** подошёл ли хотя бы один блок условий (или условий нет) */
  matched: boolean
  fields: Partial<Record<Property, string>>
}

/** применить правила к странице; matched = false — правила к этому адресу не относятся */
export function applyRules(rules: Rule[], html: string, url: string): { result: RuleResult; dom: JSDOM } {
  const dom = new JSDOM(html, { url })
  const doc = dom.window.document
  const u = new URL(url)
  const nodes = (xpath: string, line: number): Node[] => {
    try {
      const r = doc.evaluate(xpath, doc, null, dom.window.XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null)
      return Array.from({ length: r.snapshotLength }, (_, i) => r.snapshotItem(i)!).filter(Boolean)
    } catch {
      throw new RulesError(line, `ошибка в XPath «${xpath.slice(0, 80)}»`)
    }
  }
  const holds = (c: Condition, line: number) => {
    if (c.kind === 'path') return c.re.test(u.pathname)
    if (c.kind === 'domain') return c.re.test(u.hostname)
    const n = nodes(c.xpath, line).length
    return c.kind === 'exists' ? n > 0 : n === 0
  }

  const fields: RuleResult['fields'] = {}
  const hasConditions = rules.some((r) => r.kind === 'conditions')
  let active = true
  let matched = !hasConditions
  for (const r of rules) {
    if (r.kind === 'conditions') {
      active = r.list.some((c) => holds(c, r.line))
      if (active) matched = true
      continue
    }
    if (!active) continue
    if (r.kind === 'remove') {
      for (const n of nodes(r.xpath, r.line)) n.parentNode?.removeChild(n)
      continue
    }
    if (!(PROPERTIES as readonly string[]).includes(r.name)) continue // channel и др. — не наше
    const name = r.name as Property
    if (fields[name] !== undefined && !r.force) continue
    const str = STRING.exec(r.value)
    if (str) {
      fields[name] = str[1]!
      continue
    }
    const found = nodes(expandXpath(r.value), r.line)
    if (!found.length) continue
    const first = found[0] as Element
    if (name === 'body') fields.body = found.map((n) => (n as Element).outerHTML ?? n.textContent ?? '').join('\n')
    else if (name === 'cover') fields.cover = first.getAttribute?.('src') ?? first.querySelector?.('img')?.getAttribute('src') ?? first.getAttribute?.('content') ?? undefined
    else if (name === 'author_url') fields.author_url = first.getAttribute?.('href') ?? first.textContent?.trim()
    else if (name === 'published_date') fields.published_date = first.getAttribute?.('datetime') ?? first.getAttribute?.('content') ?? first.textContent?.trim()
    else if (name === 'tags') fields.tags = found.map((n) => n.textContent?.trim()).filter(Boolean).join(',')
    else fields[name] = (first.getAttribute?.('content') ?? first.textContent ?? '').replace(/\s+/g, ' ').trim()
  }
  return { result: { matched, fields }, dom }
}

const absolute = (v: string | undefined, base: string) => {
  if (!v) return null
  try {
    const x = new URL(v, base)
    return x.protocol === 'https:' || x.protocol === 'http:' ? x.toString() : null
  } catch {
    return null
  }
}

/** статья по правилам сайта; null — правила к этой странице не относятся (дальше — обычный разбор) */
export function extractByRules(src: string, html: string, url: string): Extracted | null {
  const { result } = applyRules(parseRules(src), html, url)
  if (!result.matched) return null
  const f = result.fields
  if (!f.title) throw new ExtractError('Правила сайта: не найден title')
  if (!f.body) throw new ExtractError('Правила сайта: не найден body')
  const markdown = htmlToMarkdown(f.body, url)
  const date = f.published_date && !Number.isNaN(Date.parse(f.published_date)) ? new Date(f.published_date).toISOString() : null
  return {
    url,
    site: new URL(url).hostname.replace(/^www\./, ''),
    title: f.title.slice(0, 300),
    author: f.author ?? null,
    authorUrl: absolute(f.author_url, url),
    publishedAt: date,
    tags: (f.tags ?? '').split(',').map((t) => t.trim()).filter(Boolean).slice(0, 10),
    lang: f.lang?.slice(0, 2) ?? null,
    cover: absolute(f.cover, url),
    excerpt: (f.description ?? f.subtitle ?? markdown.split(/\n{2,}/).find((p) => p.trim() && !p.startsWith('#')) ?? '').slice(0, 400),
    markdown,
  }
}
