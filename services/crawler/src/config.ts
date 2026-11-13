import { z } from 'zod'

const Env = z.object({
  PORT: z.coerce.number().int().default(8788),
  /** api — только админ-API; worker — только воркеры очередей (отдельный лёгкий процесс); all — оба */
  ROLE: z.enum(['all', 'api', 'worker']).default('all'),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  PDS_URL: z.string().url(),
  PDS_ADMIN_PASSWORD: z.string().min(1),
  /** handle краулера: crawler-<id>.<домен> */
  PDS_HANDLE_DOMAIN: z.string().min(1),
  /** 32 байта hex: шифрование паролей аккаунтов краулеров */
  SECRETS_KEY: z.string().regex(/^[0-9a-f]{64}$/i, 'openssl rand -hex 32'),
  ADMIN_TOKEN: z.string().min(32, 'не короче 32 символов: openssl rand -hex 32'),
  /** Zitadel: вход сотрудников в админку краулера */
  ZITADEL_ISSUER: z.string().url().optional(),
  ZITADEL_PROJECT_ID: z.string().optional(),
  ZITADEL_JWKS_URL: z.string().url().optional(),
  USER_AGENT: z.string().default('WeatMediaCrawler/0.1 (+https://weat.media/crawler)'),
  /** параллельных загрузок; лимит запросов к источникам — ниже */
  CONCURRENCY: z.coerce.number().int().min(1).max(16).default(2),
  /** не чаще одного запроса к источникам за столько мс */
  RATE_MS: z.coerce.number().int().min(0).default(2000),
})

export type Config = z.infer<typeof Env>

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = Env.safeParse(env)
  if (!parsed.success) throw new Error(`Invalid env:\n${z.prettifyError(parsed.error)}`)
  return parsed.data
}
