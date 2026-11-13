import { z } from 'zod'

const Env = z.object({
  PORT: z.coerce.number().int().default(8787),
  DATABASE_URL: z.string().url(),
  /** опционально: реплика для будущих read-only запросов ленты.
      НЕ использовать в read-after-write путях (auth/настройки/выплаты) — там всегда primary */
  DATABASE_READ_URL: z.string().url().optional(),
  PDS_URL: z.string().url(),
  PDS_ADMIN_PASSWORD: z.string().min(1),
  /** домен handle'ов нашего PDS: alina -> alina.indie.media */
  PDS_HANDLE_DOMAIN: z.string().min(1),
  /** 'ru' — РФ-контур: регистрация только с российских IP; вход открыт отовсюду */
  CONTOUR: z.enum(['global', 'ru']).default('global'),
  GEOIP_DB_PATH: z.string().optional(),
  /** страна для loopback/приватных IP в локальной разработке */
  GEOIP_DEV_COUNTRY: z.string().length(2).optional(),
  /** доверять X-Forwarded-For только за своим reverse proxy */
  TRUST_PROXY: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  ADMIN_TOKEN: z.string().min(16).optional(),
  /** 32 байта hex: шифрование платных текстов. Отдельно от SECRETS_KEY; не задан — берётся SECRETS_KEY */
  PAID_CONTENT_KEY: z.string().regex(/^[0-9a-f]{64}$/i).optional(),
  /** lava.top: ключ API (Интеграции → API), один продукт «Цена по запросу API» — его offerId */
  LAVA_API_KEY: z.string().optional(),
  LAVA_OFFER_ID: z.string().uuid().optional(),
  /** секрет, который lava.top присылает в X-Api-Key вебхука (до 80 символов) */
  LAVA_WEBHOOK_SECRET: z.string().min(16).max(80).optional(),
  LAVA_API_URL: z.string().url().default('https://gate.lava.top'),
  /** Zitadel — вход сотрудников (и далее читателей). ISSUER — публичный адрес, JWKS_URL — внутренний (docker) */
  ZITADEL_ISSUER: z.string().url().optional(),
  ZITADEL_PROJECT_ID: z.string().optional(),
  ZITADEL_JWKS_URL: z.string().url().optional(),
  /** сервис ленты (services/feed), например http://feed:8790 */
  FEED_URL: z.string().url().optional(),
  CORS_ORIGIN: z.string().default('http://localhost:3000'),
  /** публичный адрес сайта: OAuth redirect_uri = PUBLIC_URL/api/auth/yandex/callback */
  PUBLIC_URL: z.string().url().default('http://localhost:3000'),
  /** 32 байта hex: шифрование паролей PDS у аккаунтов внешних провайдеров */
  SECRETS_KEY: z.string().regex(/^[0-9a-f]{64}$/i, 'openssl rand -hex 32'),
  YANDEX_CLIENT_ID: z.string().optional(),
  YANDEX_CLIENT_SECRET: z.string().optional(),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GITHUB_CLIENT_ID: z.string().optional(),
  GITHUB_CLIENT_SECRET: z.string().optional(),
  /** токен бота из @BotFather; домен сайта задаётся там же командой /setdomain */
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  /** вход через внешний AT-аккаунт (bsky.social, свой PDS) */
  ATPROTO_OAUTH: z.enum(['true', 'false']).default('true').transform((v) => v === 'true'),
  /** локальный стенд: свой PLC и резолвер handle вместо публичных */
  ATPROTO_PLC_URL: z.string().url().optional(),
  ATPROTO_HANDLE_RESOLVER: z.string().url().optional(),
  ATPROTO_ALLOW_HTTP: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  /** primary | standby (горячий резерв контура, не обслуживает запросы) */
  NODE_ROLE: z.enum(['primary', 'standby']).default('primary'),
  /** AppView соседнего контура (global <-> ru): общий handle, переадресация входа */
  PEER_CONTOUR_URL: z.string().url().optional(),
  /** тестовый стенд: все OAuth-эндпоинты провайдеров на один адрес */
  OAUTH_STUB_URL: z.string().url().optional(),
})

export type Config = z.infer<typeof Env>

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = Env.safeParse(env)
  if (!parsed.success) {
    throw new Error(`Invalid env:\n${z.prettifyError(parsed.error)}`)
  }
  return parsed.data
}
