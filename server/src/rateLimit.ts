import type { Context, MiddlewareHandler } from 'hono'

/**
 * Ограничение частоты запросов в памяти узла (вторая линия после Caddy).
 * Фиксированное окно на ключ «правило + IP»: просто, O(1), память ограничена maxKeys.
 * Объёмные атаки (L3/L4) так не остановить — это задача провайдера (Yandex DDoS Protection и т. п.).
 */

export interface RateRule {
  name: string
  /** запросов за окно */
  limit: number
  windowMs: number
  match(method: string, path: string): boolean
}

/** пути — без префикса /api */
export const RULES: RateRule[] = [
  // подбор пароля, кодов 2FA, кодов сброса и handoff
  {
    name: 'auth',
    limit: 10,
    windowMs: 60_000,
    match: (m, p) => m === 'POST' && /^\/auth\/(login|register|mfa|handoff|password\/(forgot|reset)|telegram)$/.test(p),
  },
  // коды подтверждения и 2FA в настройках
  { name: 'codes', limit: 10, windowMs: 60_000, match: (m, p) => m === 'POST' && /^\/me\/(email|2fa)\//.test(p) },
  // редиректы к провайдерам: каждый создаёт состояние и запрос наружу
  { name: 'oauth-start', limit: 20, windowMs: 60_000, match: (m, p) => m === 'GET' && /^\/auth\/[a-z]+\/start$/.test(p) },
  // счета lava.top и выпуск токенов
  { name: 'purchase', limit: 10, windowMs: 60_000, match: (m, p) => m === 'POST' && (p === '/me/purchases' || p === '/me/tokens' || p === '/me/oauth-apps') },
  // публичный API по персональному токену
  { name: 'public-api', limit: 120, windowMs: 60_000, match: (_m, p) => p.startsWith('/v1/') },
  // всё остальное
  { name: 'default', limit: 600, windowMs: 60_000, match: () => true },
]

/** служебное и вебхук платёжки не ограничиваем: lava.top повторяет со своего IP */
const EXEMPT = new Set(['/health', '/webhooks/payment'])

export interface Limiter {
  /** true — пропустить; иначе секунды до сброса окна */
  hit(key: string, rule: RateRule, now?: number): true | number
}

export function createLimiter(maxKeys = 100_000): Limiter {
  const buckets = new Map<string, { count: number; reset: number }>()
  return {
    hit(key, rule, now = Date.now()) {
      let b = buckets.get(key)
      if (!b || b.reset <= now) {
        // защита памяти: при переполнении сначала выбрасываем истёкшие, затем самые старые
        if (!b && buckets.size >= maxKeys) {
          for (const [k, v] of buckets) if (v.reset <= now) buckets.delete(k)
          while (buckets.size >= maxKeys) buckets.delete(buckets.keys().next().value!)
        }
        b = { count: 0, reset: now + rule.windowMs }
        buckets.set(key, b)
      }
      b.count++
      return b.count <= rule.limit ? true : Math.ceil((b.reset - now) / 1000)
    },
  }
}

export function rateLimit(ip: (c: Context) => string, limiter = createLimiter(), rules = RULES): MiddlewareHandler {
  return async (c, next) => {
    const path = c.req.path.replace(/^\/api/, '')
    if (c.req.method === 'OPTIONS' || EXEMPT.has(path)) return next()
    const rule = rules.find((r) => r.match(c.req.method, path))!
    const r = limiter.hit(`${rule.name}|${ip(c)}`, rule)
    if (r !== true) {
      c.header('retry-after', String(r))
      return c.json({ error: 'RateLimited', message: `Слишком много запросов. Повторите через ${r} с.` }, 429)
    }
    return next()
  }
}
