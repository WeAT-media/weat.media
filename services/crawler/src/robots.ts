/**
 * robots.txt источника (RFC 9309): краулер не загружает то, что сайт запретил.
 * Группа — по нашему токену (WEATCrawlerBot) или «*»; внутри — Allow/Disallow, побеждает самое длинное
 * совпадение (при равенстве — Allow), «*» и «$» в шаблонах — как у Google. Нет файла (4xx) — можно всё.
 */

export const BOT_TOKEN = 'weatcrawlerbot'

interface Rule {
  allow: boolean
  pattern: string
  re: RegExp
}

const toRe = (p: string) => new RegExp('^' + p.replace(/[.+?^{}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\\\$$/, '$'))

/** правила для нашего бота: своя группа, если есть, иначе «*» */
export function parseRobots(txt: string, token = BOT_TOKEN): Rule[] {
  const groups: { agents: string[]; rules: Rule[] }[] = []
  let cur: { agents: string[]; rules: Rule[] } | null = null
  let lastWasAgent = false
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim()
    const m = /^([a-z-]+)\s*:\s*(.*)$/i.exec(line)
    if (!m) continue
    const key = m[1]!.toLowerCase()
    const value = m[2]!.trim()
    if (key === 'user-agent') {
      if (!cur || !lastWasAgent) groups.push((cur = { agents: [], rules: [] }))
      cur.agents.push(value.toLowerCase())
      lastWasAgent = true
      continue
    }
    lastWasAgent = false
    if (!cur || (key !== 'allow' && key !== 'disallow')) continue
    if (key === 'disallow' && !value) continue // пустой Disallow — можно всё
    cur.rules.push({ allow: key === 'allow', pattern: value, re: toRe(value) })
  }
  const own = groups.filter((g) => g.agents.some((a) => a !== '*' && token.includes(a.replace(/\/.*$/, ''))))
  const chosen = own.length ? own : groups.filter((g) => g.agents.includes('*'))
  return chosen.flatMap((g) => g.rules)
}

export function allowedByRobots(rules: Rule[], pathAndQuery: string): boolean {
  let best: Rule | null = null
  for (const r of rules) {
    if (!r.re.test(pathAndQuery)) continue
    if (!best || r.pattern.length > best.pattern.length || (r.pattern.length === best.pattern.length && r.allow)) best = r
  }
  return !best || best.allow
}
