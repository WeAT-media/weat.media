import { z } from 'zod'
import type { Sql } from './db.js'

// looseObject: фронт добавляет новые настройки быстрее сервера — неизвестные поля
// сохраняем как есть (размер ограничен ниже), иначе вся синхронизация падает с 400
const Prefs = z.looseObject({
  font: z.enum(['sans', 'serif', 'mono']),
  appearance: z.enum(['light', 'dark', 'system']),
  accent: z.enum(['terracotta', 'forest', 'indigo', 'crimson']),
  uiLang: z.enum(['ru', 'en']),
  feedSort: z.enum(['new', 'hot']),
  showCondemned: z.boolean(),
  hideTicker: z.boolean(),
  // поле добавлено позже: старые клиенты его не присылают
  tickerLang: z.enum(['system', 'ru', 'en']).optional(),
  /** теги, которые читатель выбрал для ленты */
  feedTags: z.array(z.string().trim().min(1).max(40)).max(50).optional(),
  currency: z.enum(['RUB', 'USD', 'EUR']).optional(),
}).refine((p) => JSON.stringify(p).length <= 4_000, 'prefs: слишком большой объём')

const EditorPrefs = z.strictObject({
  customBlocks: z.boolean(),
  calloutVariant: z.enum(['info', 'success', 'warning', 'danger']),
  calloutIcon: z.string().min(1).max(16),
})

const Key = z.string().min(1).max(128)

const Labelers = z
  .record(
    Key,
    z.strictObject({
      subscribed: z.boolean(),
      actions: z.record(Key, z.enum(['hide', 'warn', 'ignore'])),
    }),
  )
  .refine((r) => Object.keys(r).length <= 200, 'too many labelers')

const Tiers = z
  .array(
    z.strictObject({
      id: Key,
      name: z.string().trim().min(1).max(80),
      priceMonthly: z.number().int().min(0).max(1_000_000),
      description: z.string().max(1000),
      archived: z.boolean().optional(),
    }),
  )
  .max(20)

const Hex = z.string().regex(/^#[0-9a-f]{3,8}$/i)
const FieldDef = z.strictObject({
  key: z.string().regex(/^[a-z][a-z0-9_]{0,23}$/),
  label: z.string().max(40),
  type: z.enum(['text', 'textarea', 'select', 'image', 'link', 'color']),
  options: z.array(z.string().max(40)).max(12).optional(),
  default: z.string().max(2000).optional(),
})
/** Пользовательские блоки (Premium); формат — src/lib/userBlocks.ts на фронте */
export const BlockDefs = z
  .array(
    z.strictObject({
      id: z.string().regex(/^ub_[a-z0-9]{4,16}$/),
      name: z.string().min(1).max(40),
      icon: z.string().max(8),
      description: z.string().max(80),
      mode: z.enum(['visual', 'code']),
      fields: z.array(FieldDef).max(12),
      preset: z.enum(['callout', 'card', 'quote', 'banner']),
      accent: Hex,
      background: Hex,
      template: z.string().max(10_000),
      css: z.string().max(10_000),
      height: z.number().int().min(60).max(600),
      updatedAt: z.string().max(40),
    }),
  )
  .max(30)

/** Реквизиты выплат автора: фиат по стране или криптоадрес */
const PayoutDetails = z.strictObject({
  country: z.string().regex(/^([A-Z]{2}|other)$/),
  method: z.enum(['fiat', 'crypto']),
  asset: z.string().regex(/^[A-Z0-9]{2,10}$/),
  network: z.string().regex(/^[A-Za-z0-9-]{2,16}$/),
  cryptoAddress: z.string().max(128).regex(/^[A-Za-z0-9:_-]*$/),
})

/** «Продолжить с места»: ключ ролика → секунда, длительность, когда смотрел (мс). Видно только владельцу */
const VideoProgress = z
  .record(
    z.string().min(1).max(400),
    z.strictObject({
      t: z.number().int().min(0).max(86_400),
      d: z.number().int().min(0).max(86_400).optional(),
      at: z.number().int().min(0),
    }),
  )
  .refine((r) => Object.keys(r).length <= 200, 'videoProgress: не больше 200 роликов')

/** История прочтений — приватная, новые сверху; читатель может отключить и очистить */
const ReadHistory = z
  .array(
    z.strictObject({
      id: z.string().min(1).max(100),
      uri: z.string().max(400).optional(),
      title: z.string().max(300),
      author: z.string().max(253).optional(),
      kind: z.enum(['text', 'video']),
      at: z.number().int().min(0),
    }),
  )
  .max(200)

/** Каждый раздел заменяется целиком; отсутствующие разделы не трогаются */
export const SettingsPatch = z
  .strictObject({
    prefs: Prefs,
    editorPrefs: EditorPrefs,
    labelers: Labelers,
    juryOptOut: z.boolean(),
    payoutConnected: z.boolean(),
    tiers: Tiers,
    blockDefs: BlockDefs,
    payoutDetails: PayoutDetails,
    videoProgress: VideoProgress,
    readHistory: ReadHistory,
  })
  .partial()

export type Settings = z.infer<typeof SettingsPatch>

export interface SettingsRepo {
  get(did: string): Promise<{ data: Settings; updatedAt: string | null }>
  merge(did: string, patch: Settings): Promise<{ data: Settings; updatedAt: string }>
}

export function settingsRepo(sql: Sql): SettingsRepo {
  return {
    async get(did) {
      const [row] = await sql<{ data: Settings; updated_at: Date }[]>`
        SELECT data, updated_at FROM user_settings WHERE did = ${did}`
      return { data: row?.data ?? {}, updatedAt: row?.updated_at.toISOString() ?? null }
    },
    async merge(did, patch) {
      const [row] = await sql<{ data: Settings; updated_at: Date }[]>`
        INSERT INTO user_settings (did, data) VALUES (${did}, ${sql.json(patch as Parameters<typeof sql.json>[0])})
        ON CONFLICT (did) DO UPDATE
          SET data = user_settings.data || EXCLUDED.data, updated_at = now()
        RETURNING data, updated_at`
      return { data: row!.data, updatedAt: row!.updated_at.toISOString() }
    },
  }
}
