/**
 * OpenAPI 3.1 AppView. Схемы берутся из src/schemas.ts — те же, что валидируют запросы.
 * test/openapi.test.ts сверяет список операций с реально зарегистрированными маршрутами.
 */
import { z } from 'zod'
import * as S from './schemas.js'
import { SettingsPatch } from './settings.js'

type Method = 'get' | 'post' | 'put' | 'patch' | 'delete'

interface Op {
  method: Method
  path: string
  tag: Tag
  summary: string
  description?: string
  auth?: 'bearer' | 'admin' | 'pat' | 'staff'
  body?: z.ZodType
  query?: Record<string, { description: string; required?: boolean }>
  ok: { status: number; schema?: z.ZodType; description: string }
  errors?: [number, string][]
}

import { GrantBody, PublishPaidBody } from './paidContent.js'
import { PurchaseBody } from './lava.js'
import { ClaimBody, ClaimDto, DecideBody } from './claims.js'
import { LikeBody, LikeRefDto } from './likes.js'
import { CommentBody, CommentDto } from './comments.js'
import { ApiArticleBody, ApiCommentBody, ApiProfileBody, RotateTokenBody, ClientDto, CreateClientBody, CreateTokenBody, TokenDto, UpdateClientBody } from './developer.js'

const TAGS = {
  auth: { name: 'Вход и регистрация', description: 'Аккаунт на PDS Indie.media: регистрация, вход по паролю, обновление сессии.' },
  external: {
    name: 'Внешние аккаунты',
    description:
      'Яндекс ID, AT Protocol (bsky.social и свои PDS), Google, GitHub, Telegram. Привязать в настройках можно любой; входить российским аккаунтам и в РФ-контуре — только через российские сервисы (149-ФЗ).',
  },
  security: { name: 'Безопасность', description: 'Подтверждение email, 2FA (код на почту по умолчанию, TOTP по желанию), восстановление пароля.' },
  profile: { name: 'Профиль и настройки', description: 'Публичный профиль и настройки, которые синхронизируются между устройствами.' },
  paid: {
    name: 'Платные статьи',
    description: 'AT-репозиторий публичен, поэтому туда уходит только обложка (заголовок, тизер, условия). Полный текст хранится на площадке и отдаётся после проверки доступа.',
  },
  payments: {
    name: 'Оплата',
    description: 'Покупка платных статей. Доступ открывается после подтверждения платежа платёжным сервисом; автору — 90% суммы, Premium-автору — 99%.',
  },
  developer: {
    name: 'Разработчикам',
    description: 'Персональные токены и OAuth-приложения («Войти через weat.media»). Управление — обычной сессией из настроек; токен и секрет клиента показываются один раз.',
  },
  publicApi: {
    name: 'Публичный API (v1)',
    description: 'Публикация по персональному токену: Authorization: Bearer wm_pat_…. Запись уходит в AT-репозиторий автора как media.weat.article.',
  },
  service: { name: 'Служебное', description: 'Гео-проверка, здоровье сервиса, метаданные OAuth-клиента и эта спецификация.' },
  admin: { name: 'Администрирование', description: 'Сотрудники входят через Zitadel; права — роли проекта weat.media (admin, support, moderator). Все действия пишутся в журнал.' },
} as const
type Tag = keyof typeof TAGS

const PROVIDER_PARAM = { description: 'yandex | google | github' }

const ops: Op[] = [
  // ── вход и регистрация
  {
    method: 'post', path: '/auth/register', tag: 'auth', summary: 'Регистрация',
    description: 'Создаёт аккаунт username.indie.media и отправляет код подтверждения email. В РФ-контуре — только с российского IP.',
    body: S.RegisterBody, ok: { status: 201, schema: S.SessionSchema, description: 'Аккаунт создан' },
    errors: [[400, 'InvalidRequest'], [403, 'ContourRestricted'], [409, 'HandleTaken · EmailTaken · HandleNotAvailable']],
  },
  {
    method: 'post', path: '/auth/login', tag: 'auth', summary: 'Вход по паролю',
    description:
      'Если включена email-2FA, первый ответ — 401 AuthFactorTokenRequired и письмо с кодом; повторите запрос с authFactorToken. Если подключён TOTP — ответ { mfaRequired, mfaToken }.',
    body: S.LoginBody, ok: { status: 200, schema: S.GatedSessionSchema, description: 'Сессия или второй шаг' },
    errors: [[401, 'AuthenticationRequired · AuthFactorTokenRequired · InvalidCode']],
  },
  {
    method: 'post', path: '/auth/mfa', tag: 'auth', summary: 'Второй шаг: код TOTP',
    description: 'Код из приложения или одноразовый резервный код. Не больше 5 попыток на один mfaToken.',
    body: S.MfaBody, ok: { status: 200, schema: S.SessionSchema, description: 'Сессия' },
    errors: [[401, 'InvalidCode · InvalidMfaToken · TooManyAttempts']],
  },
  {
    method: 'post', path: '/auth/refresh', tag: 'auth', summary: 'Обновить сессию',
    body: S.RefreshBody, ok: { status: 200, schema: S.SessionSchema, description: 'Новая пара токенов' },
    errors: [[401, 'ExpiredToken']],
  },
  // ── внешние аккаунты
  {
    method: 'get', path: '/auth/{provider}/start', tag: 'external', summary: 'Вход через OAuth-провайдера',
    description: 'Редирект на страницу провайдера. Через Яндекс ID можно и зарегистрироваться; остальные входят только в привязанный аккаунт.',
    query: {
      returnTo: { description: 'Куда вернуть после входа' },
      consent: { description: '1 — пользователь отметил согласие на обработку ПДн; без него новый аккаунт не создаётся (ConsentRequired)' },
      utm_source: { description: 'First-touch UTM (также utm_medium, utm_campaign, utm_term, utm_content) — сохраняется при регистрации' },
    },
    ok: { status: 302, description: 'Редирект к провайдеру' }, errors: [[403, 'ProviderForbidden'], [404, 'NotConfigured']],
  },
  {
    method: 'get', path: '/auth/{provider}/callback', tag: 'external', summary: 'Возврат от OAuth-провайдера',
    description: 'Вызывает провайдер. Редиректит на /login?handoff=… (вход) или в настройки ?linked=… (привязка), при ошибке — ?error=код.',
    query: { code: { description: 'Код авторизации', required: true }, state: { description: 'Состояние', required: true } },
    ok: { status: 302, description: 'Редирект на сайт' },
  },
  {
    method: 'get', path: '/auth/atproto/start', tag: 'external', summary: 'Вход через AT Protocol',
    description: 'AT OAuth: находит PDS по handle и отправляет пользователя туда за согласием. Пароль чужого PDS к нам не попадает.',
    query: { handle: { description: 'alice.bsky.social или DID', required: true }, returnTo: { description: 'Куда вернуть после входа' } },
    ok: { status: 302, description: 'Редирект на PDS пользователя' },
  },
  {
    method: 'get', path: '/auth/atproto/callback', tag: 'external', summary: 'Возврат от AT-сервера',
    query: { state: { description: 'Состояние', required: true }, code: { description: 'Код', required: true }, iss: { description: 'Издатель' } },
    ok: { status: 302, description: 'Редирект на сайт' },
  },
  {
    method: 'post', path: '/auth/handoff', tag: 'external', summary: 'Обменять код handoff на сессию',
    description: 'После OAuth-редиректа токены не кладутся в URL: сайт обменивает одноразовый код (60 с).',
    body: S.HandoffBody, ok: { status: 200, schema: S.GatedSessionSchema, description: 'Сессия или второй шаг TOTP' },
    errors: [[400, 'InvalidCode']],
  },
  {
    method: 'get', path: '/auth/telegram/config', tag: 'external', summary: 'Параметры Telegram Login',
    ok: { status: 200, schema: z.object({ botId: z.string() }), description: 'ID бота' }, errors: [[404, 'NotConfigured']],
  },
  {
    method: 'post', path: '/auth/telegram/login', tag: 'external', summary: 'Вход через Telegram',
    body: S.TelegramBody, ok: { status: 200, schema: S.GatedSessionSchema, description: 'Сессия или второй шаг' },
    errors: [[400, 'InvalidSignature'], [403, 'ProviderForbidden'], [404, 'NotLinked']],
  },
  {
    method: 'get', path: '/me/identities', tag: 'external', summary: 'Связанные аккаунты', auth: 'bearer',
    ok: { status: 200, schema: S.IdentitiesSchema, description: 'Провайдеры и статус привязки' },
  },
  {
    method: 'post', path: '/me/identities/{provider}/link', tag: 'external', summary: 'Привязать OAuth-провайдера', auth: 'bearer',
    description: 'Возвращает URL провайдера. Нужна полная сессия (не через app password).',
    body: S.OAuthLinkBody, ok: { status: 200, schema: z.object({ url: z.string() }), description: 'Куда перейти' },
  },
  {
    method: 'post', path: '/me/identities/atproto/link', tag: 'external', summary: 'Привязать AT-аккаунт', auth: 'bearer',
    body: S.AtprotoLinkBody, ok: { status: 200, schema: z.object({ url: z.string() }), description: 'Куда перейти' },
    errors: [[404, 'HandleNotFound']],
  },
  {
    method: 'post', path: '/me/identities/telegram', tag: 'external', summary: 'Привязать Telegram', auth: 'bearer',
    body: S.TelegramBody, ok: { status: 201, schema: z.object({ ok: z.literal(true) }), description: 'Привязан' },
    errors: [[400, 'InvalidSignature'], [409, 'IdentityInUse · AlreadyLinked']],
  },
  {
    method: 'delete', path: '/me/identities/{provider}', tag: 'external', summary: 'Отвязать', auth: 'bearer',
    description: 'Нельзя отвязать последний способ входа и аккаунт, через который регистрировались, пока не задан пароль.',
    ok: { status: 200, schema: S.IdentitiesSchema, description: 'Обновлённый список' },
    errors: [[409, 'LastLoginMethod · PrimaryIdentity']],
  },
  // ── безопасность
  {
    method: 'get', path: '/me/security', tag: 'security', summary: 'Состояние защиты', auth: 'bearer',
    ok: { status: 200, schema: S.SecuritySchema, description: 'Email, 2FA, TOTP' },
  },
  {
    method: 'post', path: '/me/email/confirm/request', tag: 'security', summary: 'Прислать код подтверждения email', auth: 'bearer',
    ok: { status: 200, schema: z.object({ ok: z.literal(true) }), description: 'Письмо отправлено' },
  },
  {
    method: 'post', path: '/me/email/confirm', tag: 'security', summary: 'Подтвердить email', auth: 'bearer',
    description: 'После подтверждения у входящих по паролю сразу включается код на почту при входе.',
    body: S.ConfirmEmailBody, ok: { status: 200, schema: S.SecuritySchema, description: 'Новое состояние' },
    errors: [[400, 'InvalidCode']],
  },
  {
    method: 'post', path: '/me/2fa/email', tag: 'security', summary: 'Код на почту при входе: вкл/выкл', auth: 'bearer',
    description: 'Выключение в два шага: без code — письмо с кодом, затем с code.',
    body: S.Email2faBody, ok: { status: 200, schema: z.union([S.SecuritySchema, z.object({ codeSent: z.literal(true) })]), description: 'Состояние или «код отправлен»' },
    errors: [[400, 'EmailNotConfirmed · InvalidCode']],
  },
  {
    method: 'post', path: '/me/2fa/totp/setup', tag: 'security', summary: 'Начать подключение TOTP', auth: 'bearer',
    ok: { status: 200, schema: z.object({ secret: z.string().describe('Base32'), otpauthUrl: z.string().describe('Для QR-кода') }), description: 'Секрет' },
    errors: [[409, 'AlreadyEnabled']],
  },
  {
    method: 'post', path: '/me/2fa/totp/enable', tag: 'security', summary: 'Подтвердить TOTP', auth: 'bearer',
    body: S.CodeBody,
    ok: { status: 200, schema: z.object({ backupCodes: z.array(z.string()).describe('10 одноразовых кодов, показываются один раз'), security: S.SecuritySchema }), description: 'Подключено' },
    errors: [[400, 'InvalidCode · NoPendingSetup']],
  },
  {
    method: 'post', path: '/me/2fa/totp/disable', tag: 'security', summary: 'Отключить TOTP', auth: 'bearer',
    body: S.CodeBody, ok: { status: 200, schema: S.SecuritySchema, description: 'Отключено' }, errors: [[401, 'InvalidCode']],
  },
  {
    method: 'post', path: '/me/2fa/backup-codes', tag: 'security', summary: 'Новые резервные коды', auth: 'bearer',
    body: S.CodeBody, ok: { status: 200, schema: z.object({ backupCodes: z.array(z.string()) }), description: 'Старые коды больше не действуют' },
    errors: [[401, 'InvalidCode']],
  },
  {
    method: 'post', path: '/auth/password/forgot', tag: 'security', summary: 'Восстановление: прислать код',
    description: 'Ответ одинаковый, есть аккаунт или нет, — email не перебрать.',
    body: S.ForgotPasswordBody, ok: { status: 200, schema: z.object({ ok: z.literal(true) }), description: 'Принято' },
  },
  {
    method: 'post', path: '/auth/password/reset', tag: 'security', summary: 'Восстановление: новый пароль',
    body: S.ResetPasswordBody, ok: { status: 200, schema: z.object({ ok: z.literal(true) }), description: 'Пароль изменён' },
    errors: [[400, 'InvalidResetToken']],
  },
  // ── профиль и настройки
  { method: 'get', path: '/me', tag: 'profile', summary: 'Текущий пользователь', auth: 'bearer', ok: { status: 200, schema: S.PublicUserSchema, description: 'Профиль' } },
  {
    method: 'get', path: '/users/{id}', tag: 'profile', summary: 'Публичный профиль', description: 'По handle или DID. paidSubscribers — число платных подписчиков (кто подписан, не раскрывается).',
    ok: { status: 200, schema: S.ProfileSchema, description: 'Профиль' }, errors: [[404, 'NotFound']],
  },
  {
    method: 'get', path: '/me/settings', tag: 'profile', summary: 'Настройки', auth: 'bearer',
    ok: { status: 200, schema: z.object({ data: SettingsPatch, updatedAt: z.string().nullable() }), description: 'Сохранённые разделы' },
  },
  {
    method: 'patch', path: '/me/settings', tag: 'profile', summary: 'Сохранить настройки', auth: 'bearer',
    description: 'Каждый переданный раздел заменяется целиком, остальные не трогаются.',
    body: SettingsPatch, ok: { status: 200, schema: z.object({ data: SettingsPatch, updatedAt: z.string() }), description: 'Итоговые настройки' },
    errors: [[400, 'InvalidRequest']],
  },
  // ── платные статьи
  {
    method: 'post', path: '/me/articles/paid', tag: 'paid', summary: 'Опубликовать платную статью', auth: 'bearer',
    description: 'Тело шифруется и остаётся на площадке; в репозиторий автора публикуется запись media.weat.article с тизером, paywall и privateContent.',
    body: PublishPaidBody, ok: { status: 201, schema: z.object({ id: z.string(), uri: z.string().describe('at://… обложки') }), description: 'Опубликовано' },
    errors: [[400, 'InvalidRequest']],
  },
  {
    method: 'get', path: '/paid-content/{id}', tag: 'paid', summary: 'Полный текст платной статьи',
    description: 'Автору и читателям с правом доступа. Без права — 402 с условиями. Bearer необязателен.',
    ok: { status: 200, schema: z.object({ id: z.string(), title: z.string(), atUri: z.string().nullable(), body: z.string() }), description: 'Текст' },
    errors: [[402, 'PaymentRequired — в ответе title и paywall'], [404, 'NotFound']],
  },
  {
    method: 'get', path: '/me/paid-content/export', tag: 'paid', summary: 'Выгрузить свои платные тексты', auth: 'bearer',
    description: 'Портативность: автор забирает полные тексты, чтобы перенести их на другую площадку.',
    ok: { status: 200, description: 'JSON-массив статей с телами' },
  },
  {
    method: 'delete', path: '/me/articles/paid/{id}', tag: 'paid', summary: 'Удалить платную статью', auth: 'bearer',
    ok: { status: 200, schema: z.object({ ok: z.literal(true) }), description: 'Удалена (и обложка из репозитория)' },
    errors: [[404, 'NotFound']],
  },
  {
    method: 'post', path: '/admin/entitlements', tag: 'admin', summary: 'Выдать право доступа', auth: 'admin',
    description: 'Ручная выдача (поддержка). Оплаты платёжного провайдера приходят webhook\'ом.',
    body: GrantBody, ok: { status: 201, schema: z.object({ ok: z.literal(true) }), description: 'Выдано' },
    errors: [[403, 'Forbidden'], [404, 'NotFound']],
  },
  // ── авторство импортированных статей
  {
    method: 'post', path: '/me/claims', tag: 'profile', summary: 'Заявка «я автор оригинала»', auth: 'bearer',
    description: 'По статье краулера: заявка на автора источника (сайт + ник). В ответе код — разместите его в профиле на сайте; сотрудник проверит. Повторный вызов отдаёт ту же заявку.',
    body: ClaimBody, ok: { status: 201, schema: ClaimDto, description: 'Заявка' },
    errors: [[400, 'NotImported · InvalidRequest'], [404, 'NotFound'], [409, 'AlreadyClaimed — автора заявил другой пользователь']],
  },
  { method: 'get', path: '/me/claims', tag: 'profile', summary: 'Мои заявки на авторство', auth: 'bearer', ok: { status: 200, schema: z.array(ClaimDto), description: 'Заявки' } },
  {
    method: 'get', path: '/admin/claims', tag: 'admin', summary: 'Заявки на авторство', auth: 'staff',
    query: { status: { description: 'pending | approved | rejected | transferred' } },
    ok: { status: 200, description: 'Заявки с заявителем' }, errors: [[401, 'AuthenticationRequired'], [403, 'Forbidden — нужна роль support']],
  },
  { method: 'post', path: '/admin/claims/{id}/approve', tag: 'admin', summary: 'Подтвердить авторство', auth: 'staff', body: DecideBody, ok: { status: 200, schema: ClaimDto, description: 'Подтверждено' }, errors: [[404, 'NotFound — нет или уже рассмотрена']] },
  { method: 'post', path: '/admin/claims/{id}/reject', tag: 'admin', summary: 'Отклонить заявку', auth: 'staff', body: DecideBody, description: 'note обязателен — причину увидит заявитель.', ok: { status: 200, schema: ClaimDto, description: 'Отклонено' }, errors: [[400, 'InvalidRequest'], [404, 'NotFound']] },
  // ── оплата
  {
    method: 'post', path: '/me/purchases', tag: 'payments', summary: 'Купить статью', auth: 'bearer',
    description: 'Создаёт счёт и возвращает paymentUrl — страницу оплаты. После оплаты читатель вернётся на /purchase/{orderId}.',
    body: PurchaseBody, ok: { status: 201, schema: z.object({ orderId: z.string(), paymentUrl: z.string().nullable() }), description: 'Счёт создан' },
    errors: [[400, 'InvalidRequest · EmailRequired'], [404, 'NotFound'], [409, 'AlreadyPurchased'], [502, 'PaymentProviderError'], [503, 'PaymentsDisabled']],
  },
  {
    method: 'get', path: '/me/purchases/{id}', tag: 'payments', summary: 'Статус заказа', auth: 'bearer',
    ok: { status: 200, schema: z.object({ orderId: z.string(), status: z.enum(['pending', 'paid', 'failed', 'refunded']), contentId: z.string(), amount: z.number(), currency: z.string() }), description: 'Заказ' },
    errors: [[404, 'NotFound']],
  },
  {
    method: 'post', path: '/webhooks/payment', tag: 'payments', summary: 'Уведомление платёжного сервиса',
    description: 'Служебный адрес для платёжного сервиса, авторизация общим секретом. 503 — платёж ещё не подтверждён, сервис повторит.',
    ok: { status: 200, schema: z.object({ ok: z.literal(true) }), description: 'Принято' }, errors: [[401, 'Unauthorized'], [503, 'NotConfirmed']],
  },
  // ── разработчикам
  { method: 'get', path: '/me/tokens', tag: 'developer', summary: 'Мои персональные токены', auth: 'bearer', ok: { status: 200, schema: z.array(TokenDto), description: 'Список (без секретов)' } },
  {
    method: 'post', path: '/me/tokens', tag: 'developer', summary: 'Выпустить персональный токен', auth: 'bearer',
    description: 'Под токен на PDS выпускается отдельный app password. Значение token показывается один раз.',
    body: CreateTokenBody, ok: { status: 201, schema: TokenDto.extend({ token: z.string().describe('wm_pat_…') }), description: 'Выпущен' },
    errors: [[400, 'InvalidRequest'], [403, 'Forbidden — запрос персональным токеном']],
  },
  {
    method: 'post', path: '/me/tokens/{id}/rotate', tag: 'developer', summary: 'Ротация токена', auth: 'bearer',
    description: 'Новое значение того же токена: имя, права и доступ к репозиторию сохраняются, старое значение перестаёт работать сразу. Новый token показывается один раз.',
    body: RotateTokenBody, ok: { status: 200, schema: TokenDto.extend({ token: z.string().describe('wm_pat_…') }), description: 'Новое значение' },
    errors: [[404, 'NotFound — нет или истёк']],
  },
  {
    method: 'delete', path: '/v1/token', tag: 'publicApi', summary: 'Отозвать этот токен', auth: 'pat',
    description: 'Токен отзывает сам себя (утечка из CI). Работает с любыми правами; ответ всегда ok — не раскрывает, существовал ли токен.',
    ok: { status: 200, schema: z.object({ ok: z.literal(true) }), description: 'Отозван' },
  },
  { method: 'delete', path: '/me/tokens/{id}', tag: 'developer', summary: 'Отозвать токен', auth: 'bearer', ok: { status: 200, schema: z.object({ ok: z.literal(true) }), description: 'Отозван вместе с app password' }, errors: [[404, 'NotFound']] },
  { method: 'get', path: '/me/oauth-apps', tag: 'developer', summary: 'Мои OAuth-приложения', auth: 'bearer', ok: { status: 200, schema: z.array(ClientDto), description: 'Список' } },
  {
    method: 'post', path: '/me/oauth-apps', tag: 'developer', summary: 'Зарегистрировать приложение', auth: 'bearer',
    description: 'Клиент для «Войти через weat.media». clientSecret показывается один раз.',
    body: CreateClientBody, ok: { status: 201, schema: ClientDto.extend({ clientSecret: z.string() }), description: 'Создано' }, errors: [[400, 'InvalidRequest']],
  },
  { method: 'patch', path: '/me/oauth-apps/{id}', tag: 'developer', summary: 'Изменить приложение', auth: 'bearer', body: UpdateClientBody, ok: { status: 200, schema: ClientDto, description: 'Обновлено' }, errors: [[400, 'InvalidRequest'], [404, 'NotFound']] },
  { method: 'post', path: '/me/oauth-apps/{id}/secret', tag: 'developer', summary: 'Перевыпустить секрет', auth: 'bearer', ok: { status: 200, schema: ClientDto.extend({ clientSecret: z.string() }), description: 'Старый секрет больше не действует' }, errors: [[404, 'NotFound']] },
  { method: 'delete', path: '/me/oauth-apps/{id}', tag: 'developer', summary: 'Удалить приложение', auth: 'bearer', ok: { status: 200, schema: z.object({ ok: z.literal(true) }), description: 'Удалено' }, errors: [[404, 'NotFound']] },
  // ── публичный API
  { method: 'get', path: '/v1/me', tag: 'publicApi', summary: 'Владелец токена', auth: 'pat', ok: { status: 200, schema: z.object({ did: z.string(), handle: z.string(), displayName: z.string().nullable() }), description: 'Профиль' }, errors: [[401, 'InvalidToken'], [403, 'Forbidden — нет profile:read']] },
  {
    method: 'post', path: '/v1/articles', tag: 'publicApi', summary: 'Опубликовать статью', auth: 'pat',
    description: 'Нужен scope articles:write. Платные статьи через API пока не публикуются.',
    body: ApiArticleBody, ok: { status: 201, schema: z.object({ uri: z.string(), cid: z.string() }), description: 'Опубликовано' },
    errors: [[400, 'InvalidRequest'], [401, 'InvalidToken'], [403, 'Forbidden — нет articles:write']],
  },
  { method: 'delete', path: '/v1/articles/{rkey}', tag: 'publicApi', summary: 'Удалить статью', auth: 'pat', ok: { status: 200, schema: z.object({ ok: z.literal(true) }), description: 'Удалена' }, errors: [[401, 'InvalidToken'], [403, 'Forbidden — нет articles:delete']] },
  {
    method: 'patch', path: '/v1/me', tag: 'publicApi', summary: 'Изменить профиль', auth: 'pat',
    description: 'Нужен scope profile:update. Меняет app.bsky.actor.profile в репозитории (остальные поля, например аватар, сохраняются); null — очистить поле.',
    body: ApiProfileBody, ok: { status: 200, schema: z.object({ did: z.string(), handle: z.string(), displayName: z.string().nullable(), description: z.string().nullable() }), description: 'Профиль' },
    errors: [[400, 'InvalidRequest'], [401, 'InvalidToken'], [403, 'Forbidden — нет profile:update']],
  },
  {
    method: 'get', path: '/v1/me/comments', tag: 'publicApi', summary: 'Мои комментарии', auth: 'pat',
    description: 'Нужен scope comments:read. Записи media.weat.comment из репозитория владельца токена.',
    query: { limit: { description: '1–100, по умолчанию 50' }, cursor: { description: 'cursor из прошлого ответа' } },
    ok: { status: 200, description: '{ comments, cursor? }' }, errors: [[401, 'InvalidToken'], [403, 'Forbidden — нет comments:read']],
  },
  {
    method: 'post', path: '/v1/comments', tag: 'publicApi', summary: 'Оставить комментарий', auth: 'pat',
    description: 'Нужен scope comments:write. Запись media.weat.comment в репозитории автора комментария.',
    body: ApiCommentBody, ok: { status: 201, schema: z.object({ uri: z.string(), cid: z.string() }), description: 'Опубликован' },
    errors: [[400, 'InvalidRequest'], [401, 'InvalidToken'], [403, 'Forbidden — нет comments:write']],
  },
  { method: 'delete', path: '/v1/comments/{rkey}', tag: 'publicApi', summary: 'Удалить свой комментарий', auth: 'pat', ok: { status: 200, schema: z.object({ ok: z.literal(true) }), description: 'Удалён' }, errors: [[401, 'InvalidToken'], [403, 'Forbidden — нет comments:write']] },
  {
    method: 'get', path: '/feed', tag: 'profile', summary: 'Лента статей площадки',
    description: 'Статьи media.weat.article. Индекс обновляется по потоку событий PDS за ~1 с. sort=hot — (лайки + 2·комментарии + 1) / (часы + 2)^1.5 за 14 дней; sort=best — по лайкам или комментариям за период. У hot и best в ответе есть score.',
    query: {
      limit: { description: '1–100' },
      cursor: { description: 'cursor из прошлого ответа — следующая страница' },
      tags: { description: 'через запятую; статья с любым из тегов' },
      lang: { description: 'ru, en, …' },
      source: { description: 'all | internal (написано на площадке) | external (краулер, репост)' },
      author: { description: 'DID автора' },
      sort: { description: 'new (по умолчанию) | hot | best' },
      metric: { description: 'для best: likes | comments' },
      period: { description: 'для best: day | week (по умолчанию) | month | all' },
      view: { description: 'full — записи целиком; по умолчанию карточки без текста (record без text, textLength — длина текста)' },
    },
    ok: { status: 200, description: '{ articles: [{ uri, cid, did, handle, createdAt, indexedAt, record }], cursor }' },
  },
  {
    method: 'get', path: '/feed/article', tag: 'profile', summary: 'Статья целиком',
    query: { uri: { description: 'at://did/media.weat.article/rkey', required: true } },
    ok: { status: 200, description: '{ uri, cid, did, handle, createdAt, record, textLength }' }, errors: [[400, 'InvalidRequest'], [404, 'NotFound']],
  },
  // ── комментарии
  {
    method: 'get', path: '/feed/comments', tag: 'profile', summary: 'Тред статьи',
    query: { subject: { description: 'at://did/media.weat.article/rkey', required: true } },
    ok: { status: 200, schema: z.object({ comments: z.array(CommentDto) }), description: 'По возрастанию времени; ответы — с parent' },
    errors: [[400, 'InvalidRequest'], [503, 'FeedUnavailable — индекс ленты недоступен']],
  },
  {
    method: 'post', path: '/me/comments', tag: 'profile', summary: 'Оставить комментарий', auth: 'bearer',
    description: 'Запись media.weat.comment в репозитории читателя; parent — ответ на комментарий.',
    body: CommentBody, ok: { status: 201, schema: CommentDto, description: 'Комментарий в форме треда' }, errors: [[400, 'InvalidRequest'], [401, 'AuthenticationRequired']],
  },
  {
    method: 'delete', path: '/me/comments/{rkey}', tag: 'profile', summary: 'Удалить свой комментарий', auth: 'bearer',
    ok: { status: 200, schema: z.object({ ok: z.literal(true) }), description: 'Удалён' }, errors: [[400, 'InvalidRequest'], [401, 'AuthenticationRequired']],
  },
  // ── лайки
  {
    method: 'get', path: '/me/likes', tag: 'profile', summary: 'Мои лайки на статьях', auth: 'bearer',
    query: { subjects: { description: 'at://…/media.weat.article/… через запятую, до 200', required: true } },
    ok: { status: 200, schema: z.object({ likes: z.array(LikeRefDto) }), description: 'Лайкнутые из списка' }, errors: [[401, 'AuthenticationRequired']],
  },
  {
    method: 'post', path: '/me/likes', tag: 'profile', summary: 'Лайкнуть статью', auth: 'bearer',
    description: 'Запись media.weat.like в репозитории читателя. Повторный лайк той же статьи отдаёт существующую запись (200).',
    body: LikeBody, ok: { status: 201, schema: LikeRefDto, description: 'Лайк поставлен' }, errors: [[400, 'InvalidRequest'], [401, 'AuthenticationRequired']],
  },
  {
    method: 'delete', path: '/me/likes', tag: 'profile', summary: 'Снять лайк', auth: 'bearer',
    query: { subject: { description: 'at://did/media.weat.article/rkey', required: true } },
    ok: { status: 200, schema: z.object({ ok: z.literal(true), removed: z.number().int() }), description: 'Сколько записей удалено' }, errors: [[400, 'InvalidRequest'], [401, 'AuthenticationRequired']],
  },
  // ── служебное
  { method: 'get', path: '/geo', tag: 'service', summary: 'Страна и контур', ok: { status: 200, schema: S.GeoSchema, description: 'Результат GeoIP' } },
  {
    method: 'get', path: '/handles/resolve', tag: 'service', summary: 'Handle -> DID (общий для контуров)',
    description:
      'Отвечает на alina.indie.media/.well-known/atproto-did. Сначала свой контур, затем соседний. Ответ — DID текстом.',
    query: { handle: { description: 'alina.indie.media; без параметра — из Host' } },
    ok: { status: 200, description: 'DID текстом (text/plain)' },
    errors: [[404, 'не найден ни в одном контуре']],
  },
  { method: 'get', path: '/health', tag: 'service', summary: 'Проверка здоровья', ok: { status: 200, schema: z.object({ ok: z.literal(true) }), description: 'Сервис жив' } },
  { method: 'get', path: '/oauth/client-metadata.json', tag: 'service', summary: 'Метаданные AT OAuth-клиента', ok: { status: 200, description: 'client-metadata.json' } },
  { method: 'get', path: '/openapi.json', tag: 'service', summary: 'Эта спецификация', ok: { status: 200, description: 'OpenAPI 3.1' } },
  // ── администрирование
  { method: 'get', path: '/admin/me', tag: 'admin', summary: 'Кто я в админке', auth: 'staff', ok: { status: 200, schema: z.object({ sub: z.string(), name: z.string().nullable(), roles: z.array(z.string()) }), description: 'Сотрудник и роли' }, errors: [[401, 'AuthenticationRequired'], [403, 'Forbidden']] },
  {
    method: 'get', path: '/admin/audit', tag: 'admin', summary: 'Журнал действий сотрудников', auth: 'staff',
    query: { limit: { description: '1–500, по умолчанию 100' } },
    ok: { status: 200, description: 'Последние записи: actor, action, target, details, at' }, errors: [[401, 'AuthenticationRequired'], [403, 'Forbidden — нужна роль admin']],
  },
  {
    method: 'put', path: '/admin/users/{did}/tier', tag: 'admin', summary: 'Выдать или снять Premium', auth: 'admin',
    body: S.TierBody, ok: { status: 200, schema: S.PublicUserSchema, description: 'Обновлённый профиль' }, errors: [[403, 'Forbidden'], [404, 'NotFound']],
  },
]

const json = (schema: z.ZodType, io: 'input' | 'output') => z.toJSONSchema(schema, { io, unrepresentable: 'any' })

export function buildOpenApi(serverUrl = '/api') {
  const paths: Record<string, Record<string, unknown>> = {}
  for (const op of ops) {
    const pathParams = [...op.path.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!)
    const parameters = [
      ...pathParams.map((name) => ({
        name,
        in: 'path',
        required: true,
        schema: { type: 'string' },
        description: name === 'provider' ? PROVIDER_PARAM.description : name === 'did' ? 'did:plc:…' : name === 'id' && op.path.includes('paid') ? 'pc_…' : name === 'id' && op.path.includes('tokens') ? 'pat_…' : name === 'id' && op.path.includes('purchases') ? 'ord_…' : name === 'id' && op.path.includes('claims') ? 'cl_…' : name === 'id' ? 'wm_app_…' : name === 'rkey' ? 'rkey из at://…' : 'handle или DID',
      })),
      ...Object.entries(op.query ?? {}).map(([name, q]) => ({ name, in: 'query', required: !!q.required, schema: { type: 'string' }, description: q.description })),
    ]
    const responses: Record<string, unknown> = {
      [op.ok.status]: {
        description: op.ok.description,
        ...(op.ok.schema ? { content: { 'application/json': { schema: json(op.ok.schema, 'output') } } } : {}),
      },
    }
    for (const [status, codes] of op.errors ?? []) {
      responses[status] = { description: codes, content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } }
    }
    ;(paths[op.path] ??= {})[op.method] = {
      tags: [TAGS[op.tag].name],
      summary: op.summary,
      ...(op.description ? { description: op.description } : {}),
      operationId: `${op.method}${op.path.replace(/[{}]/g, '').replace(/[^a-zA-Z0-9]+(.)?/g, (_, ch: string | undefined) => (ch ?? '').toUpperCase())}`,
      ...(parameters.length ? { parameters } : {}),
      ...(op.body ? { requestBody: { required: true, content: { 'application/json': { schema: json(op.body, 'input') } } } } : {}),
      ...(op.auth ? { security: [{ [op.auth === 'admin' || op.auth === 'staff' ? 'staffToken' : op.auth === 'pat' ? 'personalToken' : 'bearer']: [] }] } : {}),
      responses,
    }
  }
  return {
    openapi: '3.1.0',
    info: {
      title: 'Indie.media AppView API',
      version: '0.1.0',
      description: 'Аккаунты, вход, безопасность и настройки Indie.media поверх AT Protocol.',
    },
    servers: [{ url: serverUrl }],
    tags: Object.values(TAGS),
    components: {
      securitySchemes: {
        bearer: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT', description: 'accessJwt из ответа входа' },
        staffToken: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT', description: 'Access-токен Zitadel сотрудника с ролью проекта (admin, support, moderator). Аварийно — ADMIN_TOKEN сервера.' },
        personalToken: { type: 'http', scheme: 'bearer', description: 'Персональный токен wm_pat_… (Настройки → Разработчикам)' },
      },
      schemas: { Error: json(S.ErrorSchema, 'output') },
    },
    paths,
  }
}

/** для теста: "METHOD /path" в формате Hono (":param") */
export const documentedRoutes = () => ops.map((o) => `${o.method.toUpperCase()} ${o.path.replace(/\{(\w+)\}/g, ':$1')}`)
