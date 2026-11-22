/**
 * Схемы запросов и ответов AppView — единый источник для валидации в маршрутах
 * и для OpenAPI (src/openapi.ts). Описания (.describe) попадают в документацию /api.
 */
import { z } from 'zod'

// ── общие ───────────────────────────────────────────────────────────────
export const Code = z.string().trim().min(6).max(20).describe('Код: 6 цифр из приложения или резервный xxxx-xxxx')
const EmailCode = z.string().trim().min(6).max(64).describe('Код из письма, формат XXXXX-XXXXX')
const ReturnTo = z.string().optional().describe('Локальный путь, куда вернуть после входа, например /compose')

export const Handle = z
  .string()
  .trim()
  .toLowerCase()
  .transform((h) => h.replace(/^@/, ''))
  .pipe(
    z
      .string()
      .regex(
        /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$|^did:[a-z]+:[a-zA-Z0-9._:%-]+$/,
        'Введите handle, например alice.bsky.social',
      ),
  )
  .describe('Handle или DID на другом AT-сервере, например alice.bsky.social')

// ── аутентификация ──────────────────────────────────────────────────────
const utmValue = z.string().trim().min(1).max(100)
export const Utm = z.object({
  source: utmValue,
  medium: utmValue.optional(),
  campaign: utmValue.optional(),
  term: utmValue.optional(),
  content: utmValue.optional(),
})
export type UtmData = z.infer<typeof Utm>

/** редакция юридических документов; меняется вместе с текстами на /legal/* */
export const LEGAL_VERSION = '2026-11-22'

export const Username = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9][a-z0-9-]{2,29}$/, 'username: 3–30 символов, латиница, цифры и дефис')

export const RegisterBody = z.object({
  username: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9][a-z0-9-]{2,29}$/, 'username: 3–30 символов, латиница, цифры и дефис')
    .describe('Станет handle username.indie.media'),
  email: z.email().describe('На него придёт код подтверждения; после подтверждения включится 2FA'),
  password: z.string().min(8).max(256),
  displayName: z.string().trim().min(1).max(64).optional(),
  consent: z
    .object({
      personalData: z.literal(true, 'Нужно согласие на обработку персональных данных'),
      terms: z.literal(true, 'Нужно принять пользовательское соглашение'),
    })
    .describe('Отдельные отметки: согласие на обработку ПДн (/legal/consent) и пользовательское соглашение (/legal/terms)'),
  utm: Utm.optional().describe('Первая UTM-метка визита (first touch) — для атрибуции регистраций'),
})

export const LoginBody = z.object({
  identifier: z.string().trim().min(1).max(256).describe('Handle или email'),
  password: z.string().min(1).max(256),
  authFactorToken: z.string().trim().max(64).optional().describe('Код из письма, если ответ был AuthFactorTokenRequired'),
})

export const RefreshBody = z.object({ refreshJwt: z.string().min(1) })
export const HandoffBody = z.object({ code: z.string().min(1).describe('Одноразовый код из ?handoff= после OAuth-редиректа') })
export const MfaBody = z.object({
  mfaToken: z.string().min(1).describe('Из ответа { mfaRequired: "totp", mfaToken }'),
  code: Code,
})
export const ForgotPasswordBody = z.object({ email: z.email() })
export const ResetPasswordBody = z.object({ token: EmailCode, password: z.string().min(8).max(256) })

// ── внешние аккаунты ────────────────────────────────────────────────────
export const OAuthLinkBody = z.object({ returnTo: ReturnTo })
export const AtprotoLinkBody = z.object({ handle: Handle, returnTo: ReturnTo })

// ── безопасность ────────────────────────────────────────────────────────
export const ConfirmEmailBody = z.object({ code: EmailCode })
export const Email2faBody = z.object({
  enabled: z.boolean(),
  code: EmailCode.optional().describe('Нужен только для выключения: сначала вызов без кода отправит письмо'),
})
export const CodeBody = z.object({ code: Code })
export const PasswordChangeBody = z.object({
  method: z.enum(['email', 'totp']),
  code: z.string().trim().min(6).max(64),
  password: z.string().min(8).max(256),
})

// ── администрирование ───────────────────────────────────────────────────
/** reason — почему выдан/снят вручную (техническая причина, компенсация): в журнал сотрудников */
/** правка профиля сотрудником: null — убрать поле */
export const AdminProfileBody = z
  .object({ displayName: z.string().trim().min(1).max(64).nullable().optional(), description: z.string().trim().max(256).nullable().optional(), reason: z.string().trim().max(500).optional() })
  .refine((b) => b.displayName !== undefined || b.description !== undefined, 'нужно displayName или description')

export const TierBody = z.object({ tier: z.enum(['free', 'premium']), reason: z.string().trim().min(5).max(500).optional() })

/** смена страны резидентства сотрудником; ticket — номер заявки в поддержку */
export const ResidenceBody = z.object({ country: z.string().regex(/^[A-Z]{2}$/), ticket: z.string().max(100).optional() })

// ── ответы (только для документации) ────────────────────────────────────
export const PublicUserSchema = z.object({
  did: z.string().describe('did:plc:…'),
  handle: z.string(),
  displayName: z.string().nullable(),
  tier: z.enum(['free', 'premium']),
  premiumSince: z.string().nullable().describe('ISO-дата'),
  createdAt: z.string().describe('ISO-дата регистрации («С нами с»)'),
  signupCountry: z.string().length(2).describe('ISO 3166-1 alpha-2 по GeoIP при регистрации; ZZ — не определена'),
})

/** публичный профиль: плюс агрегаты */
export const ProfileSchema = PublicUserSchema.extend({
  paidSubscribers: z.number().int().describe('Читатели с действующей платной подпиской на автора; без имён'),
})

export const SessionSchema = z.object({
  accessJwt: z.string(),
  refreshJwt: z.string(),
  user: PublicUserSchema,
})

export const GatedSessionSchema = z.union([
  SessionSchema,
  z.object({ mfaRequired: z.literal('totp'), mfaToken: z.string().describe('Передайте в POST /auth/mfa') }),
])

export const ErrorSchema = z.object({
  error: z.string().describe('Машинный код: InvalidRequest, AuthFactorTokenRequired, ContourRestricted…'),
  message: z.string().describe('Текст для пользователя'),
})

export const GeoSchema = z.object({
  country: z.string(),
  contour: z.enum(['global', 'ru']),
  allowed: z.boolean().describe('Можно ли регистрироваться с этого IP'),
  providers: z.array(z.enum(['yandex', 'atproto', 'google', 'github', 'telegram'])).describe('Внешние способы входа, разрешённые в этом контуре'),
})

export const SecuritySchema = z.object({
  email: z.string().nullable(),
  emailConfirmed: z.boolean(),
  emailAuthFactor: z.boolean().describe('Код на почту при входе по паролю'),
  passwordLogin: z.boolean(),
  totpEnabled: z.boolean(),
  backupCodesLeft: z.number().int(),
})

export const IdentitiesSchema = z.object({
  passwordLogin: z.boolean(),
  providers: z.array(
    z.object({
      provider: z.enum(['yandex', 'atproto', 'google', 'github', 'telegram']),
      origin: z.enum(['ru', 'foreign']),
      configured: z.boolean(),
      loginAllowed: z.boolean().describe('Можно ли входить через сервис. Для российских аккаунтов иностранные — false (149-ФЗ); привязка разрешена всегда'),
      linked: z.object({ display: z.string().nullable(), linkedAt: z.string(), primary: z.boolean() }).nullable(),
    }),
  ),
})
