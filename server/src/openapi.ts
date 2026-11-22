/**
 * OpenAPI 3.1 AppView. Схемы берутся из src/schemas.ts — те же, что валидируют запросы.
 * test/openapi.test.ts сверяет список операций с реально зарегистрированными маршрутами.
 */
import { z } from 'zod'
import * as S from './schemas.js'
import { ResidenceBody } from './schemas.js'
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
  /** contentType — не JSON: text/event-stream (SSE) и т.п.; по умолчанию application/json */
  ok: { status: number; schema?: z.ZodType; description: string; contentType?: string }
  errors?: [number, string][]
}

import { GrantBody, PublishPaidBody } from './paidContent.js'
import { PurchaseBody } from './lava.js'
import { ClaimBody, ClaimDto, DecideBody } from './claims.js'
import { LikeBody, LikeRefDto } from './likes.js'
import { ImportDraftDto, ImportStatusBody } from './imports.js'
import { MailMessageDto, MailSummaryDto, SendMailBody } from './mailbox.js'
import { AdjustBody, AdjustmentDto } from './finance.js'
import { LabelBody } from './labels.js'
import { ProfileBody } from './profile.js'
import { DraftBody, DraftDto, DraftSummaryDto } from './drafts.js'
import { CollectionBody, CollectionDto } from './collections.js'
import { SystemAccountBody } from './systemAccounts.js'
import { AdminPayoutDto, BalanceDto, PayoutDecisionBody, PayoutDto, PayoutRequestBody, SaleDto } from './payouts.js'
import { AuthorCommentDto, CommentBody, CommentDto } from './comments.js'
import { PublishArticleBody } from './articles.js'
import { DirectMessageBody, MessageBody, TicketBody, TicketDto, TicketPatch } from './tickets.js'
import { ApiArticleBody, ApiDraftBody, ApiCommentBody, ApiProfileBody, RotateTokenBody, ClientDto, CreateClientBody, CreateTokenBody, TokenDto, UpdateClientBody } from './developer.js'

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
  articles: {
    name: 'Статьи',
    description: 'Публикация с сайта (сессия) и чтение статей. Текст — markdown, формат и свои блоки описаны в разделе «Формат текста статьи». Статьи с сайта первые 24 ч в периоде охлаждения: видны только на weat.media, правятся и удаляются через /me/pending, потом уходят в AT-репозиторий автора по тому же at:// адресу. publishAt — отложенный пост: время выхода на сайте, в AT — через 24 ч после него. Публикация токеном (/v1/articles) идёт в репозиторий сразу.',
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
    errors: [[400, 'InvalidRequest'], [403, 'ContourRestricted'], [409, 'HandleTaken (с suggestion — свободный вариант) · EmailTaken · HandleNotAvailable']],
  },
  {
    method: 'get', path: '/auth/username/{name}', tag: 'auth', summary: 'Свободен ли username',
    description: 'Занят — suggestion: свободный вариант name-2, name-3, … (проверяются оба контура).',
    ok: { status: 200, schema: z.object({ available: z.boolean(), suggestion: z.string().nullable().optional() }), description: 'Ответ' },
    errors: [[400, 'InvalidRequest']],
  },
  {
    method: 'put', path: '/me/handle', tag: 'auth', summary: 'Сменить username', auth: 'bearer',
    description: 'Новый handle username.weat.media. Старый освобождается; ссылки на профиль по старому handle перестанут работать.',
    body: z.object({ username: S.Username }), ok: { status: 200, schema: z.object({ handle: z.string() }), description: 'Handle сменён' },
    errors: [[400, 'InvalidRequest'], [409, 'HandleTaken (с suggestion)']],
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
    method: 'post', path: '/me/password/email/request', tag: 'security', summary: 'Прислать код для смены пароля', auth: 'bearer',
    description: 'Для локального PDS-аккаунта с подтверждённым email. Код затем передаётся в /me/password/change.',
    ok: { status: 200, schema: z.object({ codeSent: z.literal(true) }), description: 'Письмо отправлено' }, errors: [[400, 'EmailNotConfirmed']],
  },
  {
    method: 'post', path: '/me/password/change', tag: 'security', summary: 'Задать или сменить пароль PDS', auth: 'bearer',
    description: 'method=email: код из письма после /me/password/email/request. method=totp: код приложения или резервный код.',
    body: S.PasswordChangeBody, ok: { status: 200, schema: z.object({ ok: z.literal(true) }), description: 'Пароль изменён' },
    errors: [[400, 'EmailNotConfirmed'], [401, 'InvalidCode'], [429, 'TooManyAttempts']],
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
    description: 'Требует код нового приложения и текущий пароль AT Protocol; authFactorToken — код письма при включённой email-2FA.',
    body: z.object({ code: S.CodeBody.shape.code, password: z.string().min(1).max(256), authFactorToken: z.string().max(256).optional(), refreshJwt: z.string().max(4096).optional() }),
    ok: { status: 200, schema: z.object({ backupCodes: z.array(z.string()).describe('10 одноразовых кодов, показываются один раз'), security: S.SecuritySchema }), description: 'Подключено' },
    errors: [[400, 'InvalidCode · NoPendingSetup'], [401, 'InvalidPassword · EmailCodeRequired']],
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
  { method: 'get', path: '/admin/finance/summary', tag: 'admin', summary: 'Финансы площадки: итоги, заказы, корректировки', auth: 'staff', ok: { status: 200, schema: z.object({ totals: z.array(z.record(z.string(), z.unknown())), orders: z.array(z.record(z.string(), z.unknown())), adjustments: z.array(AdjustmentDto) }), description: 'По валютам' }, errors: [[401, 'AuthenticationRequired'], [403, 'Forbidden']] },
  { method: 'get', path: '/admin/finance/users/{id}', tag: 'admin', summary: 'Баланс пользователя', auth: 'staff', ok: { status: 200, schema: z.object({ did: z.string(), handle: z.string(), balances: z.array(z.record(z.string(), z.unknown())), adjustments: z.array(AdjustmentDto) }), description: 'Баланс и корректировки' }, errors: [[404, 'NotFound']] },
  { method: 'post', path: '/admin/finance/adjustments', tag: 'admin', summary: 'Корректировка баланса (начисление или списание)', auth: 'staff', description: 'Сумма со знаком, в минимальных единицах. Списание не ниже доступного остатка. Причина обязательна.', body: AdjustBody, ok: { status: 201, schema: AdjustmentDto, description: 'Корректировка' }, errors: [[400, 'InvalidRequest'], [404, 'NotFound'], [409, 'InsufficientBalance']] },
  { method: 'get', path: '/admin/payouts', tag: 'admin', summary: 'Заявки на выплату', auth: 'staff', query: { status: { description: 'requested | paid | rejected' } }, ok: { status: 200, schema: z.array(AdminPayoutDto), description: 'Старые сверху' }, errors: [[401, 'AuthenticationRequired'], [403, 'Forbidden']] },
  { method: 'patch', path: '/admin/payouts/{id}', tag: 'admin', summary: 'Отметить выплату или отклонить', auth: 'staff', description: 'Отказ — с причиной (note), её видит автор; сумма снова доступна.', body: PayoutDecisionBody, ok: { status: 200, schema: AdminPayoutDto, description: 'Решение' }, errors: [[400, 'InvalidRequest'], [404, 'NotFound']] },
  { method: 'get', path: '/admin/labelers', tag: 'admin', summary: 'Все коллегии (для модерации)', auth: 'staff', description: 'Роль moderator. В отличие от GET /labelers, в РФ-контуре не скрывает nsfw и politics: метку можно поставить из любого контура.', ok: { status: 200, schema: z.record(z.string(), z.unknown()), description: '{ labelers }' }, errors: [[502, 'LabelerUnavailable']] },
  { method: 'post', path: '/admin/labels', tag: 'admin', summary: 'Поставить или снять метку коллегии', auth: 'staff', description: 'Роль moderator. neg: true — снять. Метку подписывает сервис коллегии.', body: LabelBody, ok: { status: 201, schema: z.record(z.string(), z.unknown()), description: 'Подписанная метка' }, errors: [[400, 'InvalidRequest'], [502, 'LabelerUnavailable'], [503, 'LabelerDisabled']] },
  { method: 'get', path: '/admin/standard', tag: 'admin', summary: 'Авторы standard.site в ленте', auth: 'staff', description: 'Только admin. Белый список авторов site.standard.document (Leaflet, pckt…): документы, handle, состояние догрузки.', ok: { status: 200, schema: z.array(z.record(z.string(), z.unknown())), description: 'Список' }, errors: [[502, 'UpstreamFailure'], [503, 'NotConfigured']] },
  { method: 'post', path: '/admin/standard', tag: 'admin', summary: 'Добавить автора standard.site в ленту', auth: 'staff', description: 'Только admin, в журнал. id — DID или handle (разрешается через публичный резолвер). История автора догружается в течение минуты.', body: z.object({ id: z.string(), note: z.string().optional() }), ok: { status: 201, schema: z.object({ did: z.string() }), description: 'Добавлен' }, errors: [[400, 'InvalidRequest'], [404, 'NotFound'], [502, 'UpstreamFailure'], [503, 'NotConfigured']] },
  { method: 'delete', path: '/admin/standard/{did}', tag: 'admin', summary: 'Убрать автора standard.site из ленты', auth: 'staff', description: 'Только admin, в журнал. Документы автора удаляются из индекса.', ok: { status: 200, schema: z.object({ ok: z.boolean() }), description: 'Убран' }, errors: [[400, 'InvalidRequest'], [502, 'UpstreamFailure']] },
  { method: 'get', path: '/admin/standard/platforms', tag: 'admin', summary: 'Площадки standard.site в ленте', auth: 'staff', description: 'Только admin. Leaflet, pckt, Offprint…: включена ли площадка целиком и сколько её документов в индексе.', ok: { status: 200, schema: z.array(z.record(z.string(), z.unknown())), description: 'Площадки' }, errors: [[502, 'UpstreamFailure'], [503, 'NotConfigured']] },
  { method: 'put', path: '/admin/standard/platforms', tag: 'admin', summary: 'Включить или выключить площадку standard.site', auth: 'staff', description: 'Только admin, в журнал. Включение — документы площадки за последние сутки догружаются из потока; выключение убирает их из ленты (кроме авторов из белого списка).', body: z.object({ contentType: z.string(), enabled: z.boolean() }), ok: { status: 200, schema: z.object({ ok: z.boolean() }), description: 'Готово' }, errors: [[400, 'InvalidRequest'], [502, 'UpstreamFailure']] },
  { method: 'get', path: '/admin/standard/block', tag: 'admin', summary: 'Заблокированные авторы standard.site', auth: 'staff', ok: { status: 200, schema: z.array(z.record(z.string(), z.unknown())), description: 'Список' }, errors: [[502, 'UpstreamFailure']] },
  { method: 'post', path: '/admin/standard/block', tag: 'admin', summary: 'Заблокировать автора standard.site', auth: 'staff', description: 'Только admin, в журнал. id — DID или handle. Документы автора удаляются из ленты, он выходит из белого списка.', body: z.object({ id: z.string(), note: z.string().optional() }), ok: { status: 201, schema: z.object({ did: z.string() }), description: 'Заблокирован' }, errors: [[400, 'InvalidRequest'], [404, 'NotFound'], [502, 'UpstreamFailure']] },
  { method: 'delete', path: '/admin/standard/block/{did}', tag: 'admin', summary: 'Снять блокировку автора standard.site', auth: 'staff', ok: { status: 200, schema: z.object({ ok: z.boolean() }), description: 'Снята' }, errors: [[400, 'InvalidRequest'], [502, 'UpstreamFailure']] },
  { method: 'get', path: '/admin/system-accounts', tag: 'admin', summary: 'Системные и служебные учётки', auth: 'staff', ok: { status: 200, schema: z.array(z.record(z.string(), z.unknown())), description: 'news, crawler, коллегии…' }, errors: [[403, 'Forbidden']] },
  { method: 'post', path: '/admin/system-accounts', tag: 'admin', summary: 'Создать системную учётку', auth: 'staff', description: 'Только admin. handle = username.<домен>, почта system+username@<домен>; пароль знает только сервер.', body: SystemAccountBody, ok: { status: 201, schema: z.record(z.string(), z.unknown()), description: 'Создана' }, errors: [[400, 'InvalidRequest'], [409, 'HandleTaken']] },
  { method: 'get', path: '/admin/users/{did}/identities', tag: 'admin', summary: 'Способы входа пользователя', auth: 'staff', description: 'Роль support.', ok: { status: 200, schema: z.object({ identities: z.array(z.object({ provider: z.string(), display: z.string().nullable(), createdAt: z.string() })) }), description: 'Привязки' } },
  { method: 'delete', path: '/admin/users/{did}/identities/{provider}', tag: 'admin', summary: 'Отвязать способ входа', auth: 'staff', description: 'Роль admin, в журнал. Для дублей из разных контуров: у второго аккаунта отвязывают провайдера — вход через него найдёт основной аккаунт в соседнем контуре.', body: z.object({ reason: z.string().optional() }), ok: { status: 200, schema: z.object({ ok: z.literal(true) }), description: 'Отвязано' }, errors: [[404, 'NotFound']] },
  { method: 'post', path: '/admin/system-accounts/{did}/login', tag: 'admin', summary: 'Войти как системная учётка', auth: 'staff', description: 'Одноразовый код для /login?handoff=…; в людей войти нельзя. В журнал.', ok: { status: 200, schema: z.object({ code: z.string() }), description: 'Код входа' }, errors: [[404, 'NotFound']] },
  { method: 'put', path: '/admin/users/{did}/profile', tag: 'admin', summary: 'Правка профиля пользователя', auth: 'staff', description: 'Только admin, в журнал. Служебная учётка — запись app.bsky.actor.profile (scope: repo). Человек — только имя на сайте (scope: site).', body: S.AdminProfileBody, ok: { status: 200, schema: z.record(z.string(), z.unknown()), description: 'Профиль' }, errors: [[400, 'InvalidRequest'], [404, 'NotFound']] },
  // ── почта площадки: support@ — support и admin; legal@, noreply@ — admin
  { method: 'get', path: '/admin/mail/boxes', tag: 'admin', summary: 'Доступные сотруднику ящики', auth: 'staff', ok: { status: 200, schema: z.object({ boxes: z.array(z.enum(['support', 'legal', 'noreply'])) }), description: 'Ящики по ролям' }, errors: [[401, 'AuthenticationRequired']] },
  {
    method: 'get', path: '/admin/mail/{box}/messages', tag: 'admin', summary: 'Входящие ящика', auth: 'staff',
    query: { before: { description: 'UID: письма старше него (следующая страница)' }, limit: { description: '1–100, по умолчанию 50' } },
    ok: { status: 200, schema: z.object({ messages: z.array(MailSummaryDto), nextBeforeUid: z.number().int().nullable() }), description: 'Новые сверху' },
    errors: [[401, 'AuthenticationRequired'], [403, 'Forbidden'], [404, 'NotFound'], [502, 'MailUnavailable']],
  },
  { method: 'get', path: '/admin/mail/{box}/messages/{uid}', tag: 'admin', summary: 'Письмо (текст; отмечается прочитанным)', auth: 'staff', ok: { status: 200, schema: MailMessageDto, description: 'Письмо' }, errors: [[401, 'AuthenticationRequired'], [403, 'Forbidden'], [404, 'NotFound']] },
  { method: 'get', path: '/admin/mail/{box}/messages/{uid}/attachments/{id}', tag: 'admin', summary: 'Скачать вложение', auth: 'staff', ok: { status: 200, schema: z.string().describe('application/octet-stream'), description: 'Файл' }, errors: [[401, 'AuthenticationRequired'], [403, 'Forbidden'], [404, 'NotFound']] },
  {
    method: 'post', path: '/admin/mail/{box}/send', tag: 'admin', summary: 'Отправить или ответить', auth: 'staff',
    description: 'С noreply@ не отправляем. replyToUid — ответ в ветке (In-Reply-To/References).',
    body: SendMailBody, ok: { status: 201, schema: z.object({ messageId: z.string() }), description: 'Отправлено' },
    errors: [[400, 'InvalidRequest'], [401, 'AuthenticationRequired'], [403, 'Forbidden'], [502, 'MailUnavailable']],
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
    method: 'post', path: '/me/premium', tag: 'payments', summary: 'Оплатить Premium на 30 дней', auth: 'bearer',
    description: 'Создаёт счёт и возвращает paymentUrl. Premium включается после подтверждения оплаты; повторная оплата продлевает срок. После оплаты — /purchase/{orderId}.',
    body: z.object({ paymentMethod: z.enum(['CARD', 'SBP']).optional() }), ok: { status: 201, schema: z.object({ orderId: z.string(), paymentUrl: z.string().nullable() }), description: 'Счёт создан' },
    errors: [[400, 'EmailRequired'], [502, 'PaymentProviderError'], [503, 'PaymentsDisabled']],
  },
  {
    method: 'get', path: '/me/purchases/{id}', tag: 'payments', summary: 'Статус заказа', auth: 'bearer',
    description: 'Заказ статьи (ord_…) или Premium (prm_…: kind = premium, paidUntil — до какого момента оплачен).',
    ok: { status: 200, schema: z.object({ orderId: z.string(), status: z.enum(['pending', 'paid', 'failed', 'refunded']), kind: z.literal('premium').optional(), paidUntil: z.string().nullable().optional(), contentId: z.string().optional(), amount: z.number(), currency: z.string() }), description: 'Заказ' },
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
    description: 'Нужен scope articles:write. Запись сразу уходит в AT-репозиторий (без периода охлаждения). Текст — markdown, формат — раздел «Формат текста статьи». Платные статьи через API пока не публикуются.',
    body: ApiArticleBody, ok: { status: 201, schema: z.object({ uri: z.string(), cid: z.string() }), description: 'Опубликовано' },
    errors: [[400, 'InvalidRequest'], [401, 'InvalidToken'], [403, 'Forbidden — нет articles:write']],
  },
  {
    method: 'post', path: '/v1/drafts', tag: 'publicApi', summary: 'Создать черновик', auth: 'pat',
    description: 'Нужен scope articles:write. Черновик не публикуется и в репозиторий не пишется — его видит только автор (Настройки → Черновики, /compose?draft=<id>), вычитывает в редакторе и публикует сам. Удобно для переноса статей с других площадок. Текст — markdown, формат — раздел «Формат текста статьи». До 200 черновиков на автора.',
    body: ApiDraftBody, ok: { status: 201, schema: z.object({ id: z.string(), editUrl: z.string(), createdAt: z.string() }), description: 'Черновик создан' },
    errors: [[400, 'InvalidRequest'], [401, 'InvalidToken'], [403, 'Forbidden — нет articles:write'], [409, 'TooManyDrafts']],
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
    method: 'get', path: '/feed/stream', tag: 'profile', summary: 'Живая лента статей (SSE)',
    description: [
      'Server-Sent Events: статья появилась на сайте, изменилась или удалена. Подписка: `new EventSource("https://weat.media/api/feed/stream")`.',
      '',
      'События (поле `event`): `ready` — подключились (retry 5 с); `created`, `updated`, `deleted` — данные ниже; `ping` — раз в 20 с тишины; `lagged` — часть событий пропущена (`{ missed }`), перечитайте `GET /feed`.',
      '',
      'Источники: индекс ленты (всё, что записано в AT — PDS площадки и документы standard.site авторов из белого списка) и охлаждение: статья уже видна на сайте, но уйдёт в AT через 24 ч (`pending: true`). После охлаждения придёт `created` ещё раз — сводите события по `uri`.',
      '',
      'Только метаданные: текст — `GET /feed/article?short=<id>`. В РФ-контуре записи с метками nsfw/politics не рассылаются. Без авторизации; до 2000 подписчиков на узел (дальше 503).',
    ].join('\n'),
    ok: {
      status: 200,
      contentType: 'text/event-stream',
      description: 'Поток событий; data — JSON',
      schema: z.object({
        type: z.enum(['created', 'updated', 'deleted']),
        uri: z.string().describe('at://did/media.weat.article/rkey или at://did/site.standard.document/rkey'),
        did: z.string(),
        id: z.string().describe('короткий id: /article/<id>'),
        title: z.string().optional(),
        createdAt: z.string().optional(),
        paid: z.boolean().optional(),
        sourceSite: z.string().optional().describe('домен внешней записи (standard.site, перепечатка)'),
        pending: z.boolean().optional().describe('видна на сайте, в AT ещё не ушла (охлаждение)'),
        at: z.string().describe('время события'),
      }),
    },
    errors: [[503, 'TooManyListeners']],
  },
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
      kind: { description: 'all | video | text' },
      view: { description: 'full — записи целиком; по умолчанию карточки без текста (record без text, textLength — длина текста)' },
    },
    ok: { status: 200, description: '{ articles: [{ uri, cid, did, handle, createdAt, indexedAt, record }], cursor }' },
  },
  {
    method: 'get', path: '/feed/article', tag: 'articles', summary: 'Статья целиком',
    query: { uri: { description: 'at://did/media.weat.article/rkey', required: true } },
    ok: { status: 200, description: '{ uri, cid, did, handle, createdAt, record, textLength }' }, errors: [[400, 'InvalidRequest'], [404, 'NotFound']],
  },
  { method: 'get', path: '/me/articles/{rkey}/standard-site', tag: 'articles', summary: 'Копия статьи в standard.site: состояние', auth: 'bearer', description: 'inPds — статья уже записана в репозиторий (не на охлаждении); eligible — бесплатная и без noindex; mirrored — копия site.standard.document есть.', ok: { status: 200, schema: z.object({ inPds: z.boolean(), eligible: z.boolean(), mirrored: z.boolean() }), description: 'Состояние' }, errors: [[401, 'AuthenticationRequired']] },
  { method: 'post', path: '/me/articles/{rkey}/standard-site', tag: 'articles', summary: 'Скопировать статью в standard.site', auth: 'bearer', description: 'Для статей, опубликованных до копий: site.standard.document с тем же rkey. Только записанные в PDS (на охлаждении — 409, копия появится сама), бесплатные и без noindex.', ok: { status: 201, schema: z.object({ uri: z.string() }), description: 'Копия' }, errors: [[400, 'NotEligible'], [401, 'AuthenticationRequired'], [409, 'NotInRepository']] },
  {
    method: 'post', path: '/me/articles', tag: 'articles', summary: 'Опубликовать статью или видео', auth: 'bearer',
    description: 'Статья (media.weat.article) с сайта. Первые 24 ч — период охлаждения: ответ сразу даёт uri (он не изменится), cid пустой, pendingUntil — когда запись уйдёт в AT-репозиторий; до этого правка и удаление — /me/pending. publishAt — отложенный пост: время выхода на сайте, в AT — ровно через 24 ч после него; до выхода на сайте видит только автор. draftId — черновик: рецензенты из совместного редактирования попадут в запись. kind=video — с плейлистом videos (native — https-адрес файла, youtube/loom — videoId). Платные — через /me/articles/paid.',
    body: PublishArticleBody, ok: { status: 201, schema: z.object({ uri: z.string(), cid: z.string().describe('пусто, пока запись в охлаждении'), pendingUntil: z.string().optional().describe('когда уйдёт в AT'), visibleAt: z.string().optional().describe('когда выйдет на сайте') }), description: 'Опубликовано (на сайте; в AT — после охлаждения)' },
    errors: [[400, 'InvalidRequest'], [401, 'AuthenticationRequired']],
  },
  // ── комментарии
  {
    method: 'get', path: '/feed/comments', tag: 'profile', summary: 'Тред статьи или комментарии пользователя',
    query: { subject: { description: 'at://did/media.weat.article/rkey — тред по возрастанию времени' }, author: { description: 'did:… — комментарии пользователя, новые сверху, с заголовком статьи' } },
    ok: { status: 200, schema: z.object({ comments: z.union([z.array(CommentDto), z.array(AuthorCommentDto)]) }), description: 'subject → CommentDto[]; author → AuthorCommentDto[]' },
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
  {
    method: 'get', path: '/me/notifications', tag: 'profile', summary: 'Персональные уведомления', auth: 'bearer',
    description: 'Только записи авторов по подписке, комментарии к своим записям и ответы на свои комментарии.',
    query: { limit: { description: '1–100, по умолчанию 50' } },
    ok: { status: 200, description: '{ notifications: [{ id, kind, actorDid, actorHandle, subjectUri, articleUri, articleTitle, createdAt, readAt }] }' },
  },
  {
    method: 'post', path: '/me/notifications/read', tag: 'profile', summary: 'Отметить уведомления прочитанными', auth: 'bearer',
    body: z.object({ ids: z.array(z.string()) }), ok: { status: 200, schema: z.object({ ok: z.literal(true) }), description: 'Готово' },
  },
  { method: 'post', path: '/me/notifications/read-all', tag: 'profile', summary: 'Прочитать все уведомления', auth: 'bearer', ok: { status: 200, schema: z.object({ ok: z.literal(true) }), description: 'Готово' } },
  { method: 'get', path: '/me/author-subscriptions', tag: 'profile', summary: 'Подписки на авторов', auth: 'bearer', ok: { status: 200, description: '{ authors: DID[] }' } },
  { method: 'put', path: '/me/author-subscriptions/{authorDid}', tag: 'profile', summary: 'Подписаться на автора', auth: 'bearer', ok: { status: 200, schema: z.object({ ok: z.literal(true) }), description: 'Подписка сохранена' }, errors: [[400, 'InvalidRequest'], [404, 'NotFound']] },
  { method: 'delete', path: '/me/author-subscriptions/{authorDid}', tag: 'profile', summary: 'Отписаться от автора', auth: 'bearer', ok: { status: 200, schema: z.object({ ok: z.literal(true) }), description: 'Подписка удалена' } },
  {
    method: 'get', path: '/admin/users', tag: 'admin', summary: 'Пользователи', auth: 'staff',
    query: { q: { description: 'начало handle или DID; пусто — последние зарегистрированные' } },
    ok: { status: 200, description: 'До 100: handle, тариф, страны регистрации и резидентства' }, errors: [[401, 'AuthenticationRequired'], [403, 'Forbidden']],
  },
  { method: 'get', path: '/admin/users/{did}', tag: 'admin', summary: 'Пользователь и его обращения', auth: 'staff', ok: { status: 200, description: 'Карточка и обращения с перепиской' }, errors: [[404, 'NotFound']] },
  {
    method: 'post', path: '/admin/users/{did}/messages', tag: 'admin', summary: 'Написать пользователю', auth: 'staff',
    description: 'Создаёт обращение от поддержки: пользователь увидит его в «Моих обращениях» и уведомлениях и сможет ответить. В аудит.',
    body: DirectMessageBody, ok: { status: 201, description: 'Обращение с сообщением' }, errors: [[400, 'InvalidRequest'], [404, 'NotFound']],
  },
  {
    method: 'put', path: '/admin/users/{did}/residence', tag: 'admin', summary: 'Сменить страну резидентства', auth: 'staff',
    description: 'По заявке из поддержки после проверки документа. Страна регистрации не меняется. Смена пишется в аудит.',
    body: ResidenceBody, ok: { status: 200, description: 'Профиль с новой страной резидентства' },
    errors: [[400, 'InvalidRequest'], [401, 'AuthenticationRequired'], [403, 'Forbidden — нужна роль support'], [404, 'NotFound']],
  },
  // ── устройства
  {
    method: 'get', path: '/me/sessions', tag: 'security', summary: 'Мои устройства', auth: 'bearer',
    description: 'Сессии аккаунта: устройство по User-Agent, страна входа, когда вошли и когда были активны; current — это устройство.',
    ok: { status: 200, description: 'До 50, активные сверху' }, errors: [[401, 'AuthenticationRequired · SessionRevoked']],
  },
  { method: 'delete', path: '/me/sessions/{id}', tag: 'security', summary: 'Завершить сессию', auth: 'bearer', ok: { status: 200, description: 'Завершена — её токены больше не принимаются' }, errors: [[404, 'NotFound']] },
  { method: 'post', path: '/me/sessions/revoke-others', tag: 'security', summary: 'Завершить все, кроме этого устройства', auth: 'bearer', ok: { status: 200, description: '{ ok, revoked }' } },
  { method: 'get', path: '/admin/users/{did}/sessions', tag: 'admin', summary: 'Устройства пользователя', auth: 'staff', ok: { status: 200, description: 'Сессии аккаунта' }, errors: [[403, 'Forbidden']] },
  { method: 'delete', path: '/admin/users/{did}/sessions/{id}', tag: 'admin', summary: 'Завершить сессию пользователя', auth: 'staff', ok: { status: 200, description: 'В аудит' }, errors: [[404, 'NotFound']] },
  { method: 'post', path: '/admin/users/{did}/sessions/revoke-all', tag: 'admin', summary: 'Завершить все сессии пользователя', auth: 'staff', ok: { status: 200, description: '{ ok, revoked } · в аудит' } },
  // ── обращения
  {
    method: 'post', path: '/support/tickets', tag: 'service', summary: 'Обращение в поддержку или запрос органа',
    description: 'Можно без входа (ответ придёт на email). Вошедшему привязывается DID. Документ не загружается — только тип и метаданные файла.',
    body: TicketBody, ok: { status: 201, schema: TicketDto, description: 'Номер и статус обращения' }, errors: [[400, 'InvalidRequest']],
  },
  {
    method: 'get', path: '/admin/tickets', tag: 'admin', summary: 'Обращения', auth: 'staff',
    query: { status: { description: 'new | in_progress | waiting | resolved | rejected; без параметра — все' } },
    ok: { status: 200, description: 'Последние 500, новые сверху' }, errors: [[401, 'AuthenticationRequired'], [403, 'Forbidden — нужна роль support']],
  },
  { method: 'get', path: '/admin/tickets/{id}', tag: 'admin', summary: 'Обращение', auth: 'staff', ok: { status: 200, description: 'Обращение целиком' }, errors: [[404, 'NotFound']] },
  {
    method: 'patch', path: '/admin/tickets/{id}', tag: 'admin', summary: 'Статус и заметка сотрудника', auth: 'staff',
    description: 'Смена пишется в аудит.', body: TicketPatch, ok: { status: 200, description: 'Обновлённое обращение' }, errors: [[400, 'InvalidRequest'], [404, 'NotFound']],
  },
  {
    method: 'post', path: '/admin/tickets/{id}/messages', tag: 'admin', summary: 'Ответ заявителю', auth: 'staff',
    description: 'Обращение переходит в «Ждут ответа». На площадке ответ увидит только заявитель, писавший из аккаунта (deliverable).',
    body: MessageBody, ok: { status: 201, description: 'Обращение с перепиской' }, errors: [[400, 'InvalidRequest'], [404, 'NotFound']],
  },
  {
    method: 'get', path: '/me/tickets', tag: 'profile', summary: 'Мои обращения', auth: 'bearer',
    description: 'Обращения, отправленные из этого аккаунта, с перепиской; unread — новые ответы сотрудника.',
    ok: { status: 200, description: 'Последние 100' }, errors: [[401, 'AuthenticationRequired']],
  },
  { method: 'post', path: '/me/tickets/{id}/seen', tag: 'profile', summary: 'Ответы прочитаны', auth: 'bearer', ok: { status: 200, description: 'ok' }, errors: [[404, 'NotFound']] },
  {
    method: 'post', path: '/me/tickets/{id}/messages', tag: 'profile', summary: 'Ответить в обращение', auth: 'bearer',
    description: 'Возвращает обращение в работу.', body: MessageBody, ok: { status: 201, description: 'Обращение с перепиской' }, errors: [[400, 'InvalidRequest'], [404, 'NotFound']],
  },
  // ── выплаты автору (продажи lava.top)
  {
    method: 'get', path: '/me/earnings', tag: 'paid', summary: 'Баланс, продажи и заявки на выплату', auth: 'bearer',
    description: 'Суммы — в минимальных единицах валюты. Оплаченное за последние holdDays дней ещё не доступно к выводу.',
    ok: { status: 200, schema: z.object({ holdDays: z.number().int(), balances: z.array(BalanceDto), sales: z.array(SaleDto), payouts: z.array(PayoutDto) }), description: 'По валютам' },
    errors: [[401, 'AuthenticationRequired']],
  },
  {
    method: 'post', path: '/me/payouts', tag: 'paid', summary: 'Заявка на выплату всей доступной суммы', auth: 'bearer',
    description: 'Реквизиты хранятся зашифрованными; в ответах — только последние 4 символа.',
    body: PayoutRequestBody, ok: { status: 201, schema: PayoutDto, description: 'Заявка создана, сумма зарезервирована' },
    errors: [[400, 'InvalidRequest'], [401, 'AuthenticationRequired'], [409, 'BelowMinimum | BalanceChanged']],
  },
  {
    method: 'get', path: '/share/article/{id}', tag: 'articles', summary: 'Читаемый HTML статьи и превью ссылки',
    description: 'Полный публичный текст, canonical, og:/twitter:-теги и BlogPosting для поисковых, AI- и соцсетевых ботов; id — из адреса /article/<id>. Людям Caddy отдаёт SPA.',
    ok: { status: 200, schema: z.string().describe('text/html'), description: 'Страница статьи' },
    errors: [[404, 'NotFound']],
  },
  {
    method: 'get', path: '/sitemap.xml', tag: 'articles', summary: 'Sitemap публичных страниц, статей и авторов',
    description: 'До 5000 последних публикаций из регионального индекса; noindex, перенесённые и закрытые в контуре записи исключаются.',
    ok: { status: 200, schema: z.string().describe('application/xml'), description: 'Sitemap XML' },
    errors: [[503, 'Unavailable']],
  },
  { method: 'get', path: '/profile-record/{did}', tag: 'profile', summary: 'Имя и «О себе» из профиля AT', description: 'Запись app.bsky.actor.profile с PDS автора (по DID-документу) — для автора из любого контура.', ok: { status: 200, schema: z.object({ displayName: z.string().nullable(), description: z.string().nullable() }), description: 'Профиль' }, errors: [[400, 'InvalidRequest']] },
  { method: 'get', path: '/blob/{did}/{cid}', tag: 'profile', summary: 'Файл автора (фото профиля) с его PDS', description: 'Редирект 302 на com.atproto.sync.getBlob PDS из DID-документа автора — работает для авторов любого контура и сторонних PDS.', ok: { status: 302, schema: z.string(), description: 'Редирект на PDS автора' }, errors: [[400, 'InvalidRequest'], [404, 'NotFound']] },
  { method: 'get', path: '/og/article/{file}', tag: 'articles', summary: 'Картинка превью статьи (1200×630)', description: 'file — <id>.png из адреса /article/<id>: название статьи, имя и фото автора. Нет статьи или закрыта в контуре — редирект на общую /og-image.png.', ok: { status: 200, schema: z.string().describe('image/png'), description: 'PNG' } },
  { method: 'get', path: '/image-proxy', tag: 'articles', summary: 'Картинка для редактора с чужого сайта', query: { url: { description: 'http(s)://… картинки', required: true } }, description: 'Редактор загружает ![…](https://…) из markdown через AppView (CSP сайта не пускает браузер к чужим адресам). Только публичные адреса, только image/*, до 10 МБ.', ok: { status: 200, schema: z.string().describe('image/*'), description: 'Картинка' }, errors: [[400, 'InvalidRequest'], [404, 'NotFound'], [413, 'TooLarge']] },
  { method: 'post', path: '/link-preview', tag: 'profile', summary: 'Превью ссылки для редактора', auth: 'bearer', description: 'Open Graph страницы по ссылке (карточка «/link»). Только http(s) на 80/443, внутренние адреса запрещены, кэш — час.', body: z.object({ url: z.string().max(2000) }), ok: { status: 200, schema: z.object({ url: z.string(), title: z.string().nullable(), description: z.string().nullable(), image: z.string().nullable(), icon: z.string().nullable() }), description: 'Превью' }, errors: [[401, 'AuthenticationRequired'], [404, 'NotFound']] },
  { method: 'get', path: '/labelers', tag: 'profile', summary: 'Коллегии присяжных и их метки', ok: { status: 200, schema: z.object({ labelers: z.array(z.record(z.string(), z.unknown())) }), description: 'Коллегии' }, errors: [[502, 'LabelerUnavailable'], [503, 'LabelerDisabled']] },
  { method: 'get', path: '/labels', tag: 'profile', summary: 'Действующие метки на записях', query: { uris: { description: 'at://… через запятую, до 100', required: true } }, ok: { status: 200, schema: z.object({ labels: z.array(z.record(z.string(), z.unknown())) }), description: 'Подписанные метки (com.atproto.label.defs#label)' } },
  { method: 'post', path: '/pds/createSession', tag: 'external', summary: 'Вход в PDS снаружи (через Caddy)', description: 'pds.weat.media/xrpc/com.atproto.server.createSession: у аккаунтов с TOTP полный вход паролем отклоняется, пароль приложения работает.', ok: { status: 200, schema: z.record(z.string(), z.unknown()), description: 'Ответ PDS' }, errors: [[401, 'AuthFactorTokenRequired'], [502, 'UpstreamFailure']] },
  { method: 'post', path: '/pds/oauth-sign-in', tag: 'external', summary: 'Вход через OAuth на странице PDS (через Caddy)', description: 'pds.weat.media/@atproto/oauth-provider/~api/sign-in: у аккаунтов с TOTP вход закрыт (400 invalid_request) — нужен пароль приложения; остальные запросы и ответы PDS проходят без изменений.', body: z.object({ identifier: z.string(), password: z.string() }).passthrough(), ok: { status: 200, schema: z.record(z.string(), z.unknown()), description: 'Ответ PDS' }, errors: [[400, 'invalid_request'], [503, 'server_error']] },
  { method: 'get', path: '/peer/totp', tag: 'external', summary: 'Включён ли TOTP у пользователя контура', description: 'Только для соседнего контура (x-indie-peer-hop + общий секрет). Нужен гейту входа через OAuth: PDS общий, база TOTP — у контура пользователя.', ok: { status: 200, schema: z.object({ totp: z.boolean() }), description: 'Состояние' }, errors: [[404, 'NotFound']] },
  { method: 'post', path: '/peer/oauth-login', tag: 'external', summary: 'Вход через провайдера в соседнем контуре', description: 'Только для соседнего контура (x-indie-peer-hop + общий секрет). Если здесь есть аккаунт с этой привязкой провайдера — одноразовый код /login?handoff=… на нашем адресе; так вход не создаёт второй аккаунт. Без email и имени.', body: z.object({ provider: z.string(), providerUserId: z.string(), country: z.string() }), ok: { status: 200, schema: z.object({ code: z.string() }), description: 'Код входа' }, errors: [[403, 'ProviderForbidden'], [404, 'NotFound']] },
  { method: 'get', path: '/peer/cooldown', tag: 'external', summary: 'Записи в охлаждении для соседнего контура', description: 'Только с заголовком x-indie-peer-hop. Статьи и комментарии, которые уже видны на сайте, но ещё не ушли в AT: соседний контур показывает их у себя.', ok: { status: 200, schema: z.object({ items: z.array(z.record(z.string(), z.unknown())) }), description: 'Ждущие записи' }, errors: [[404, 'NotFound']] },
  { method: 'get', path: '/peer/users/{id}', tag: 'external', summary: 'Публичный профиль для соседнего контура', description: 'Только с заголовком x-indie-peer-hop. handle, DID, имя, дата, служебная ли учётка — без email, стран и тарифа (152-ФЗ).', ok: { status: 200, schema: z.object({ did: z.string(), handle: z.string(), displayName: z.string().nullable(), createdAt: z.string(), service: z.string().nullable() }), description: 'Профиль' }, errors: [[404, 'NotFound']] },
  { method: 'get', path: '/rss/author/{handle}', tag: 'profile', summary: 'RSS автора', description: 'В РФ-контуре без записей с метками nsfw/politics.', ok: { status: 200, schema: z.string().describe('application/rss+xml'), description: 'RSS 2.0' } },
  { method: 'get', path: '/rss/comments/{did}/{rkey}', tag: 'profile', summary: 'RSS комментариев к статье', ok: { status: 200, schema: z.string().describe('application/rss+xml'), description: 'RSS 2.0' } },
  { method: 'post', path: '/me/claims/{id}/transfer', tag: 'profile', summary: 'Забрать статьи по одобренной заявке', auth: 'bearer', description: 'Статьи автора-источника у краулера копируются в ваш репозиторий (claimedFrom — оригинал); оригинал уходит из ленты, его адрес открывает копию. Комментарии и лайки остаются у старой записи.', ok: { status: 200, schema: z.object({ moved: z.number().int(), articles: z.array(z.object({ oldUri: z.string(), newUri: z.string() })) }), description: 'Перенесено' }, errors: [[404, 'NotFound'], [409, 'NotApproved']] },
  // ── профиль: имя, «О себе», аватар (запись app.bsky.actor.profile — видна и в Bluesky)
  { method: 'patch', path: '/me/profile', tag: 'profile', summary: 'Имя и «О себе»', auth: 'bearer', body: ProfileBody, ok: { status: 200, schema: z.object({ did: z.string(), displayName: z.string().nullable(), description: z.string().nullable(), avatar: z.string().nullable() }), description: 'Профиль' }, errors: [[400, 'InvalidRequest'], [401, 'AuthenticationRequired']] },
  { method: 'post', path: '/me/avatar', tag: 'profile', summary: 'Загрузить фото профиля', auth: 'bearer', description: 'Тело — файл PNG, JPEG или WebP до 1 МБ (тип — по сигнатуре файла). Картинка: <PDS>/xrpc/com.atproto.sync.getBlob?did=…&cid=<avatar>.', ok: { status: 200, schema: z.object({ avatar: z.string().nullable() }), description: 'CID аватара' }, errors: [[401, 'AuthenticationRequired'], [413, 'ImageTooLarge'], [415, 'UnsupportedImage']] },
  { method: 'delete', path: '/me/avatar', tag: 'profile', summary: 'Убрать фото профиля', auth: 'bearer', ok: { status: 200, schema: z.object({ avatar: z.null() }), description: 'Без фото' } },
  { method: 'post', path: '/v1/me/avatar', tag: 'publicApi', summary: 'Фото профиля по токену', auth: 'pat', description: 'Право profile:update. Тело — PNG/JPEG/WebP до 1 МБ.', ok: { status: 200, schema: z.object({ avatar: z.string().nullable() }), description: 'CID аватара' }, errors: [[401, 'InvalidToken'], [403, 'InsufficientScope'], [413, 'ImageTooLarge'], [415, 'UnsupportedImage']] },
  { method: 'delete', path: '/v1/me/avatar', tag: 'publicApi', summary: 'Убрать фото профиля по токену', auth: 'pat', ok: { status: 200, schema: z.object({ avatar: z.null() }), description: 'Без фото' } },
  { method: 'get', path: '/users/search', tag: 'profile', summary: 'Подсказки для @упоминаний', query: { q: { description: 'часть handle или имени', required: true } }, ok: { status: 200, schema: z.object({ users: z.array(z.object({ handle: z.string(), displayName: z.string().nullable() })) }), description: 'До 8 человек' } },
  // ── черновики (личные, в репозиторий не пишутся)
  { method: 'get', path: '/me/drafts', tag: 'profile', summary: 'Мои черновики', auth: 'bearer', ok: { status: 200, schema: z.object({ drafts: z.array(DraftSummaryDto) }), description: 'Свежие сверху' } },
  { method: 'post', path: '/me/drafts', tag: 'profile', summary: 'Новый черновик', auth: 'bearer', body: DraftBody, ok: { status: 201, schema: DraftDto, description: 'Создан' }, errors: [[409, 'TooManyDrafts']] },
  { method: 'get', path: '/me/drafts/{id}', tag: 'profile', summary: 'Черновик', auth: 'bearer', ok: { status: 200, schema: DraftDto, description: 'Черновик' }, errors: [[404, 'NotFound']] },
  { method: 'put', path: '/me/drafts/{id}', tag: 'profile', summary: 'Сохранить черновик', auth: 'bearer', body: DraftBody, ok: { status: 200, schema: DraftDto, description: 'Сохранён' }, errors: [[404, 'NotFound']] },
  { method: 'delete', path: '/me/drafts/{id}', tag: 'profile', summary: 'Удалить черновик', auth: 'bearer', ok: { status: 200, schema: z.object({ ok: z.literal(true) }), description: 'Удалён' }, errors: [[404, 'NotFound']] },
  // ── публичные подборки статей
  { method: 'get', path: '/collections', tag: 'articles', summary: 'Подборки авторов', ok: { status: 200, schema: z.object({ collections: z.array(CollectionDto) }), description: 'До 500 свежих подборок' } },
  { method: 'get', path: '/collections/{id}', tag: 'articles', summary: 'Подборка', ok: { status: 200, schema: CollectionDto, description: 'Подборка и упорядоченные id статей' }, errors: [[404, 'NotFound']] },
  { method: 'get', path: '/peer/collections', tag: 'external', summary: 'Подборки для соседнего контура', description: 'Только с заголовком x-indie-peer-hop.', ok: { status: 200, schema: z.object({ collections: z.array(CollectionDto) }), description: 'Публичные подборки этого контура' }, errors: [[404, 'NotFound']] },
  { method: 'get', path: '/me/collections', tag: 'profile', summary: 'Мои подборки', auth: 'bearer', ok: { status: 200, schema: z.object({ collections: z.array(CollectionDto) }), description: 'Подборки автора' } },
  { method: 'post', path: '/me/collections', tag: 'profile', summary: 'Создать подборку', auth: 'bearer', description: 'id можно передать при переносе локальной подборки; повтор с тем же id обновляет её без дубля.', body: CollectionBody, ok: { status: 201, schema: CollectionDto, description: 'Создана' } },
  { method: 'put', path: '/me/collections/{id}', tag: 'profile', summary: 'Сохранить подборку', auth: 'bearer', body: CollectionBody, ok: { status: 200, schema: CollectionDto, description: 'Сохранена' }, errors: [[404, 'NotFound']] },
  // ── период охлаждения: 24 ч запись только на сайте, потом — в репозиторий автора по тому же адресу
  { method: 'get', path: '/me/pending', tag: 'articles', summary: 'Мои записи в периоде охлаждения', auth: 'bearer', description: 'Статьи и комментарии, которые ещё не ушли в AT (pendingUntil — когда уйдут; scheduledAt — отложенный пост ещё не вышел на сайте).', ok: { status: 200, schema: z.object({ items: z.array(z.record(z.string(), z.unknown())) }), description: 'Ждущие записи' } },
  { method: 'put', path: '/me/pending', tag: 'articles', summary: 'Исправить запись в охлаждении', auth: 'bearer', query: { uri: { description: 'at://… записи', required: true } }, description: 'Статья: title, subtitle, text, excerpt, tags, noindex, republished (null — убрать перепечатку), publishAt. Комментарий: text. После ухода в AT — 409.', body: z.record(z.string(), z.unknown()), ok: { status: 200, schema: z.record(z.string(), z.unknown()), description: 'Обновлённая запись' }, errors: [[404, 'NotFound'], [409, 'AlreadyPublished']] },
  { method: 'post', path: '/me/pending/to-draft', tag: 'articles', summary: 'Вернуть отложенную статью в черновики', auth: 'bearer', query: { uri: { description: 'at://… статьи', required: true } }, description: 'Только ещё не вышедшая на сайте статья. Создаёт личный черновик и снимает запись с публикации; в AT ничего не уходит.', ok: { status: 201, schema: z.object({ draft: z.record(z.string(), z.unknown()) }), description: 'Черновик создан' }, errors: [[404, 'NotFound'], [409, 'NotScheduled']] },
  { method: 'delete', path: '/me/pending', tag: 'articles', summary: 'Удалить запись в охлаждении без следа', auth: 'bearer', query: { uri: { description: 'at://… записи', required: true } }, ok: { status: 200, schema: z.object({ ok: z.literal(true) }), description: 'Удалена — в сеть не уходила' }, errors: [[404, 'NotFound'], [409, 'AlreadyPublished']] },
  { method: 'get', path: '/admin/cooldown', tag: 'admin', summary: 'Очередь охлаждения (модерация)', auth: 'staff', description: 'Роль moderator. Все ждущие записи, включая отложенные до выхода. Только просмотр; метка — POST /admin/labels по тому же at:// адресу.', ok: { status: 200, schema: z.object({ items: z.array(z.record(z.string(), z.unknown())) }), description: 'Очередь' } },
  // ── совместное редактирование черновика по ссылке (24 ч, только для вошедших)
  { method: 'post', path: '/me/drafts/{id}/share', tag: 'profile', summary: 'Ссылка для совместного редактирования', auth: 'bearer', description: 'Создаёт ссылку /shared-draft/<token> на 24 ч или возвращает действующую.', ok: { status: 201, schema: z.object({ token: z.string(), expiresAt: z.string() }), description: 'Ссылка' }, errors: [[404, 'NotFound']] },
  { method: 'get', path: '/me/drafts/{id}/share', tag: 'profile', summary: 'Действующая ссылка и рецензенты черновика', auth: 'bearer', ok: { status: 200, schema: z.object({ token: z.string().nullable(), expiresAt: z.string().nullable(), reviewers: z.array(z.object({ did: z.string(), handle: z.string().nullable(), displayName: z.string().nullable() })) }), description: 'Состояние' }, errors: [[404, 'NotFound']] },
  { method: 'get', path: '/shared/{token}', tag: 'profile', summary: 'Черновик по ссылке', auth: 'bearer', ok: { status: 200, schema: z.record(z.string(), z.unknown()), description: 'Заголовок, текст, автор, рецензенты, срок' }, errors: [[401, 'AuthenticationRequired'], [404, 'NotFound'], [410, 'Expired']] },
  { method: 'get', path: '/shared/{token}/updates', tag: 'profile', summary: 'Обновления Yjs после seq', auth: 'bearer', query: { after: { description: 'последний полученный seq' } }, ok: { status: 200, schema: z.object({ updates: z.array(z.object({ seq: z.number().int(), data: z.string() })) }), description: 'Обновления (base64)' }, errors: [[410, 'Expired']] },
  { method: 'post', path: '/shared/{token}/updates', tag: 'profile', summary: 'Отправить обновление Yjs', auth: 'bearer', description: 'edited: true — правка руками: не-автор становится рецензентом черновика. seed — первое наполнение, только автор.', body: z.object({ data: z.string(), edited: z.boolean().optional(), seed: z.boolean().optional() }), ok: { status: 201, schema: z.object({ seq: z.number().int() }), description: 'Принято' }, errors: [[403, 'Forbidden'], [409, 'AlreadySeeded'], [410, 'Expired'], [413, 'TooLarge']] },
  { method: 'put', path: '/shared/{token}/text', tag: 'profile', summary: 'Сохранить markdown черновика', auth: 'bearer', body: z.object({ title: z.string(), text: z.string() }), ok: { status: 200, schema: z.object({ ok: z.literal(true) }), description: 'Сохранено' }, errors: [[410, 'Expired']] },
  // ── импорт из AT-аккаунта
  {
    method: 'post', path: '/me/imports/atproto', tag: 'profile', summary: 'Импортировать посты AT-аккаунта в черновики', auth: 'bearer',
    description: 'Читает app.bsky.feed.post привязанного AT-аккаунта (до 1000 постов, без ответов). Уже импортированные пропускаются. Ничего не публикует.',
    ok: { status: 200, schema: z.object({ added: z.number().int(), seen: z.number().int(), complete: z.boolean().describe('false — постов больше лимита') }), description: 'Сколько черновиков добавлено' },
    errors: [[401, 'AuthenticationRequired'], [404, 'NotLinked'], [502, 'SourceUnavailable']],
  },
  {
    method: 'get', path: '/me/imports', tag: 'profile', summary: 'Черновики из импорта', auth: 'bearer',
    query: { status: { description: 'pending | published | dismissed; без — все' } },
    ok: { status: 200, schema: z.object({ drafts: z.array(ImportDraftDto) }), description: 'Новые сверху' }, errors: [[401, 'AuthenticationRequired']],
  },
  {
    method: 'get', path: '/me/imports/{id}', tag: 'profile', summary: 'Черновик из импорта', auth: 'bearer',
    ok: { status: 200, schema: ImportDraftDto, description: 'Черновик' }, errors: [[401, 'AuthenticationRequired'], [404, 'NotFound']],
  },
  {
    method: 'patch', path: '/me/imports/{id}', tag: 'profile', summary: 'Отметить черновик выпущенным или отклонённым', auth: 'bearer',
    description: 'Сама публикация — POST /me/articles; здесь только статус черновика.',
    body: ImportStatusBody, ok: { status: 200, schema: ImportDraftDto, description: 'Обновлён' }, errors: [[400, 'InvalidRequest'], [401, 'AuthenticationRequired'], [404, 'NotFound']],
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
  {
    method: 'get', path: '/feed/related', tag: 'profile', summary: 'Читать дальше',
    description: 'Статьи с общими тегами (3 за тег) и общими читателями (2 за читателя, только лайки с весом > 0), делённые на √(дни + 1). Индекс недоступен — пустой список.',
    query: { uri: { description: 'at://did/media.weat.article/rkey', required: true }, limit: { description: '1–20, по умолчанию 3' }, kind: { description: 'video | text — только этого типа' } },
    ok: { status: 200, description: '{ articles: [...] } — карточки без текста, со score' }, errors: [[400, 'InvalidRequest']],
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

/** служебное — не для публичной документации: /admin/* и всё, что требует сотрудника */
const isInternal = (op: Op) => op.tag === 'admin' || op.auth === 'admin' || op.auth === 'staff'

/**
 * internal = false (по умолчанию, /api/openapi.json и страница /api): без админки — пользователям незачем знать,
 * что она есть. Маршруты /admin/* от этого не открываются: их закрывает роль сотрудника (requireStaff).
 */
export function buildOpenApi(serverUrl = '/api', { internal = false }: { internal?: boolean } = {}) {
  const paths: Record<string, Record<string, unknown>> = {}
  for (const op of ops) {
    if (!internal && isInternal(op)) continue
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
        ...(op.ok.schema ? { content: { [op.ok.contentType ?? 'application/json']: { schema: json(op.ok.schema, 'output') } } } : {}),
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
    tags: Object.values(TAGS).filter((t) => internal || t !== TAGS.admin),
    components: {
      securitySchemes: {
        bearer: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT', description: 'accessJwt из ответа входа' },
        ...(internal
          ? { staffToken: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT', description: 'Access-токен Zitadel сотрудника с ролью проекта (admin, support, moderator). Аварийно — ADMIN_TOKEN сервера.' } }
          : {}),
        personalToken: { type: 'http', scheme: 'bearer', description: 'Персональный токен wm_pat_… (Настройки → Разработчикам)' },
      },
      schemas: { Error: json(S.ErrorSchema, 'output') },
    },
    paths,
  }
}

/** для теста: "METHOD /path" в формате Hono (":param") */
export const documentedRoutes = () => ops.map((o) => `${o.method.toUpperCase()} ${o.path.replace(/\{(\w+)\}/g, ':$1')}`)
