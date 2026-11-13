import { randomBytes, timingSafeEqual } from 'node:crypto'
import { Hono, type Context } from 'hono'
import { cors } from 'hono/cors'
import { bodyLimit } from 'hono/body-limit'
import { z } from 'zod'
import type { Config } from './config.js'
import type { IdentityRepo, MfaRepo, Tier, UserRepo, UserRow } from './db.js'
import type { SecretBox } from './secretbox.js'
import type { AtprotoAuth } from './atprotoOAuth.js'
import { mountContourRoutes, type PeerContour } from './contour.js'
import { mountPaidRoutes, type PaidRepo } from './paidContent.js'
import { mountIdentityRoutes } from './identityRoutes.js'
import { mountDeveloperRoutes, type DeveloperRepo } from './developer.js'
import { mountFeedRoutes } from './feed.js'
import { mountLikeRoutes } from './likes.js'
import { mountCommentRoutes } from './comments.js'
import { mountArticleRoutes } from './articles.js'
import { mountClaimRoutes, type ClaimRepo } from './claims.js'
import { mountTicketRoutes, type TicketRepo } from './tickets.js'
import { mountMailboxRoutes, type MailboxClient } from './mailbox.js'
import { atprotoPostSource, mountImportRoutes, type ImportRepo, type PostSource } from './imports.js'
import { mountSessionRoutes, sessionTracking, type SessionRepo } from './sessions.js'
import { rateLimit, type Limiter } from './rateLimit.js'
import type { AuditRepo, Staff, StaffRole, StaffVerifier } from './staff.js'
import { mountLavaRoutes, type LavaClient, type OrderRepo } from './lava.js'
import { createMfaGate, MFA_SESSION_TTL, mountSecurityRoutes, tokenHash } from './securityRoutes.js'
import type { OAuthClient, OAuthProviderId } from './providers.js'
import { contourAllows, type GeoLookup } from './geo.js'
import { PdsError, type PdsClient, type PdsSession } from './pds.js'
import { buildOpenApi } from './openapi.js'
import { LEGAL_VERSION, LoginBody, RefreshBody, RegisterBody, ResidenceBody, TierBody } from './schemas.js'
import { SettingsPatch, type SettingsRepo } from './settings.js'

export interface Deps {
  config: Pick<Config, 'CONTOUR' | 'PDS_HANDLE_DOMAIN' | 'TRUST_PROXY' | 'ADMIN_TOKEN' | 'CORS_ORIGIN' | 'PUBLIC_URL'> & Partial<Pick<Config, 'LAVA_OFFER_ID' | 'LAVA_WEBHOOK_SECRET'>>
  users: UserRepo
  settings: SettingsRepo
  identities: IdentityRepo
  mfa: MfaRepo
  paid: PaidRepo
  /** персональные токены и OAuth-приложения разработчиков */
  developer: DeveloperRepo
  orders: OrderRepo
  claims: ClaimRepo
  tickets: TicketRepo
  sessions: SessionRepo
  imports: ImportRepo
  /** почта площадки (/admin/email); не задана — ящиков нет */
  mail?: MailboxClient
  /** посты внешних AT-аккаунтов для импорта; по умолчанию — публичные репозитории через plc.directory */
  postSource?: PostSource
  /** сервис ленты; не задан — лента собирается обходом PDS */
  feedUrl?: string
  /** lava.top; не задан — оплата выключена (503 PaymentsDisabled) */
  lava?: LavaClient
  /** сотрудники: JWT Zitadel; не задан — только аварийный ADMIN_TOKEN */
  staff?: StaffVerifier
  audit?: AuditRepo
  /** false — без ограничения частоты (тесты); по умолчанию — лимитер в памяти узла */
  rateLimiter?: Limiter | false
  /** ключ закрытого хранилища платных текстов */
  paidBox: SecretBox
  secrets: SecretBox
  /** настроенные OAuth-провайдеры; отсутствующий — выключен */
  oauth: Partial<Record<OAuthProviderId, OAuthClient>>
  telegramBotToken?: string
  atproto?: AtprotoAuth
  /** соседний контур того же ресурса (global <-> ru) */
  peer?: PeerContour
  /** standby — горячий резерв: не обслуживает запросы до переключения */
  nodeRole?: 'primary' | 'standby'
  pds: PdsClient
  geo: GeoLookup
  /** IP TCP-соединения; X-Forwarded-For учитывается только при TRUST_PROXY */
  socketIp: (c: Context) => string
}

export interface PublicUser {
  did: string
  handle: string
  displayName: string | null
  tier: Tier
  premiumSince: string | null
  createdAt: string
  /** только себе (сессия, /me): в публичном профиле страны не отдаём */
  signupCountry?: string
  residenceCountry?: string
}

export function toPublic(u: UserRow): PublicUser {
  return {
    did: u.did,
    handle: u.handle,
    displayName: u.display_name,
    tier: u.tier,
    premiumSince: u.premium_since?.toISOString() ?? null,
    createdAt: u.created_at.toISOString(),
  }
}

/** свой профиль: плюс страны — регистрации (неизменна) и резидентства (меняется по заявке) */
export function toSelf(u: UserRow): PublicUser {
  return { ...toPublic(u), signupCountry: u.signup_country, residenceCountry: u.residence_country ?? u.signup_country }
}



function sessionDto(s: PdsSession, user: UserRow) {
  return { accessJwt: s.accessJwt, refreshJwt: s.refreshJwt, user: toSelf(user) }
}

function bearer(c: Context): string | undefined {
  const h = c.req.header('authorization')
  return h?.startsWith('Bearer ') ? h.slice(7) : undefined
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  return ab.length === bb.length && timingSafeEqual(ab, bb)
}

/**
 * Токен PDS можно получить и в обход AppView (createSession прямо на PDS) — без нашего TOTP.
 * Поэтому у аккаунтов с TOTP принимаем только токены, отмеченные после второго шага.
 */
function guardPds(pds: PdsClient, mfa: Deps['mfa']): PdsClient {
  return {
    ...pds,
    async getSession(token) {
      const info = await pds.getSession(token)
      if ((await mfa.get(info.did)).totpEnabledAt && !(await mfa.isSessionMarked(tokenHash(token)))) {
        throw new PdsError(401, 'MfaRequired', 'Войдите заново: нужен код из приложения-аутентификатора')
      }
      return info
    },
  }
}

export function createApp(deps: Deps) {
  const d: Deps = { ...deps, pds: guardPds(deps.pds, deps.mfa) }
  const app = new Hono().basePath('/api')

  const clientIp = (c: Context): string => {
    if (d.config.TRUST_PROXY) {
      const xff = c.req.header('x-forwarded-for')?.split(',')[0]?.trim()
      if (xff) return xff
    }
    return d.socketIp(c)
  }

  app.use('*', cors({ origin: d.config.CORS_ORIGIN, allowHeaders: ['content-type', 'authorization'] }))
  // до всех маршрутов: иначе ранние обработчики ответят раньше лимитера
  if (d.rateLimiter !== false) app.use('*', rateLimit(clientIp, d.rateLimiter))
  // тело разбирается до валидации — без лимита гигантский JSON съест память.
  // Тексты статей (до 200 000 символов UTF-8) — до 1 МБ, остальное — 64 КБ
  const tooLarge = (c: Context) => c.json({ error: 'PayloadTooLarge', message: 'Слишком большой запрос' }, 413)
  const BIG = new Set(['/api/me/articles/paid', '/api/v1/articles'])
  app.use('*', async (c, next) =>
    bodyLimit({ maxSize: BIG.has(c.req.path) ? 1024 * 1024 : 64 * 1024, onError: tooLarge })(c, next),
  )
  // журнал устройств: завершённая сессия не проходит; выданная пара токенов — запись (sessions.ts)
  app.use('*', sessionTracking({ sessions: d.sessions }, { bearer, country: (c) => d.geo.country(clientIp(c)) }))
  mountContourRoutes(app, { users: d.users, peer: d.peer, nodeRole: d.nodeRole ?? 'primary' })

  const geoOf = (c: Context) => {
    const country = d.geo.country(clientIp(c))
    return { country, contour: d.config.CONTOUR, allowed: contourAllows(d.config.CONTOUR, country) }
  }

  const contourDenied = (c: Context, country: string) =>
    c.json(
      {
        error: 'ContourRestricted',
        message: 'Регистрация в РФ-контуре доступна только с российского IP-адреса. Отключите VPN и повторите. Вход в существующий аккаунт работает из любой страны.',
        country,
      },
      403,
    )

  app.onError((err, c) => {
    if (err instanceof PdsError) {
      const status = ['HandleNotAvailable', 'HandleTaken', 'EmailTaken', 'InvalidHandle'].includes(err.code) ? 409
        : err.status === 401 || ['AuthenticationRequired', 'ExpiredToken', 'InvalidToken'].includes(err.code) ? 401
        : [400, 402, 403, 404, 409, 429, 502, 503].includes(err.status) ? (err.status as 400 | 402 | 403 | 404 | 409 | 429 | 502 | 503)
        : 502
      return c.json({ error: err.code, message: err.message }, status)
    }
    console.error(err)
    return c.json({ error: 'InternalServerError', message: 'Внутренняя ошибка сервера' }, 500)
  })

  app.get('/health', (c) => c.json({ ok: true }))

  const spec = buildOpenApi()
  app.get('/openapi.json', (c) => c.json(spec))

  const mfaGate = createMfaGate(d)

  /** сотрудник с нужной ролью: JWT Zitadel или аварийный ADMIN_TOKEN (только автоматизация) */
  const requireStaff = async (c: Context, role: StaffRole): Promise<Staff | 'break-glass'> => {
    const token = bearer(c)
    if (token && d.config.ADMIN_TOKEN && safeEqual(token, d.config.ADMIN_TOKEN)) return 'break-glass'
    const staff = token && d.staff ? await d.staff.verify(token) : null
    if (!staff) throw new PdsError(401, 'AuthenticationRequired', 'Войдите в админку через weat.media')
    // admin может всё, что могут support и moderator
    if (!staff.roles.has(role) && !staff.roles.has('admin')) throw new PdsError(403, 'Forbidden', `Нужна роль ${role}`)
    return staff
  }
  const audit = async (who: Staff | 'break-glass', action: string, target: string | null, details?: Record<string, unknown>) => {
    await d.audit?.log({
      actor: who === 'break-glass' ? 'break-glass' : `zitadel:${who.sub}`,
      actorName: who === 'break-glass' ? null : who.name,
      action,
      target,
      details: details ?? null,
    })
  }

  app.get('/admin/me', async (c) => {
    const staff = await requireStaff(c, 'support')
    if (staff === 'break-glass') return c.json({ sub: 'break-glass', name: null, roles: ['admin'] })
    return c.json({ sub: staff.sub, name: staff.name, roles: [...staff.roles] })
  })

  app.get('/admin/audit', async (c) => {
    await requireStaff(c, 'admin')
    const limit = Math.min(500, Math.max(1, Number(c.req.query('limit')) || 100))
    return c.json(await d.audit?.recent(limit) ?? [])
  })
  /** сессии Яндекс-пользователей, у которых adoptPassword ждёт второго шага */
  const pendingAdopt = new Set<string>()
  mountSecurityRoutes(app, d, {
    bearer,
    // после второго шага — то, что при обычном входе делается сразу (см. /auth/login)
    afterMfa: async (s) => {
      const user = await d.users.findByDid(s.user.did)
      if (user && !user.password_login && pendingAdopt.delete(s.accessJwt)) await adoptPassword(user, s.accessJwt)
    },
  })
  mountPaidRoutes(
    app,
    { users: d.users, pds: d.pds, paid: d.paid, paidBox: d.paidBox, publicUrl: d.config.PUBLIC_URL },
    { bearer, requireStaff, audit },
  )
  mountLavaRoutes(
    app,
    { users: d.users, pds: d.pds, paid: d.paid, orders: d.orders, lava: d.lava, offerId: d.config.LAVA_OFFER_ID, webhookSecret: d.config.LAVA_WEBHOOK_SECRET, publicUrl: d.config.PUBLIC_URL },
    { bearer },
  )
  mountClaimRoutes(app, { users: d.users, pds: d.pds, claims: d.claims }, { bearer, requireStaff, audit })
  mountTicketRoutes(app, { pds: d.pds, tickets: d.tickets, users: d.users }, { bearer, requireStaff, audit })
  mountSessionRoutes(app, { pds: d.pds, sessions: d.sessions }, { bearer, requireStaff, audit })
  mountMailboxRoutes(app, { mail: d.mail }, { requireStaff, audit })
  mountFeedRoutes(app, { pds: d.pds, feedUrl: d.feedUrl })
  mountLikeRoutes(app, { pds: d.pds, feedUrl: d.feedUrl }, { bearer })
  mountCommentRoutes(app, { pds: d.pds, feedUrl: d.feedUrl }, { bearer })
  mountArticleRoutes(app, { pds: d.pds }, { bearer })
  mountImportRoutes(app, { pds: d.pds, identities: d.identities, imports: d.imports, source: d.postSource ?? atprotoPostSource() }, { bearer })
  mountDeveloperRoutes(app, { users: d.users, pds: d.pds, developer: d.developer, secrets: d.secrets }, { bearer })
  const ids = mountIdentityRoutes(app, d, { geoOf, sessionDto, safeEqual, bearer, gate: mfaGate.gate })

  app.get('/geo', (c) => c.json({ ...geoOf(c), providers: ids.loginProviders() }))

  /**
   * Пользователь без пароля (Яндекс-регистрация) задал его через сброс и вошёл:
   * старый основной пароль в привязке больше не действует — меняем его на app password.
   */
  const adoptPassword = async (user: UserRow, accessJwt: string) => {
    await d.users.setPasswordLogin(user.did, true)
    for (const i of await d.identities.listByDid(user.did)) {
      if (i.appPasswordName !== null) continue
      const name = `indie-${i.provider}-${randomBytes(3).toString('hex')}`
      const { password } = await d.pds.createAppPassword(accessJwt, name)
      await d.identities.updateSecret(user.did, i.provider, d.secrets.seal(password), name)
    }
  }

  /** handle общий для контуров: занят у соседа — значит занят. Сосед недоступен — не рискуем дублем */
  const assertHandleFree = async (handle: string) => {
    if (!d.peer) return
    let did: string | null
    try {
      did = await d.peer.resolve(handle)
    } catch {
      throw new PdsError(503, 'PeerUnavailable', 'Не удалось проверить, свободно ли имя. Попробуйте через минуту.')
    }
    if (did) throw new PdsError(409, 'HandleTaken', 'Этот username уже занят')
  }

  app.post('/auth/register', async (c) => {
    const geo = geoOf(c)
    if (!geo.allowed) return contourDenied(c, geo.country)

    const body = RegisterBody.safeParse(await c.req.json().catch(() => null))
    if (!body.success) return c.json({ error: 'InvalidRequest', message: z.prettifyError(body.error) }, 400)

    const { username, email, password, displayName, utm } = body.data
    const handle = `${username}.${d.config.PDS_HANDLE_DOMAIN}`
    if (await d.users.findByHandleOrDid(handle)) throw new PdsError(409, 'HandleTaken', 'Этот username уже занят')
    await assertHandleFree(handle)
    const session = await d.pds.createAccount({ handle, email, password })
    const user = await d.users.insert({
      did: session.did,
      handle: session.handle,
      displayName,
      signupCountry: geo.country,
      signupUtm: utm,
      consentVersion: LEGAL_VERSION,
    })
    // код подтверждения email: после подтверждения включится email-2FA
    await d.pds.requestEmailConfirmation(session.accessJwt).catch((err) => console.error('email confirmation', err))
    return c.json(sessionDto(session, user), 201)
  })

  // вход открыт из любой страны (командировки, отпуск); РФ-контур ограничивает только регистрацию
  app.post('/auth/login', async (c) => {
    const geo = geoOf(c)
    const body = LoginBody.safeParse(await c.req.json().catch(() => null))
    if (!body.success) return c.json({ error: 'InvalidRequest', message: z.prettifyError(body.error) }, 400)

    let session: PdsSession
    try {
      session = await d.pds.createSession(body.data.identifier, body.data.password, body.data.authFactorToken)
    } catch (err) {
      if (err instanceof PdsError && err.code === 'AuthFactorTokenRequired') {
        throw new PdsError(401, 'AuthFactorTokenRequired', 'Мы отправили код на вашу почту — введите его')
      }
      if (err instanceof PdsError && err.code === 'InvalidToken' && body.data.authFactorToken) {
        throw new PdsError(401, 'InvalidCode', 'Неверный или устаревший код из письма')
      }
      // аккаунта нет в этом контуре, но handle живёт у соседа (например, РФ-аккаунт за границей)
      const ident = body.data.identifier.toLowerCase()
      if (err instanceof PdsError && err.status === 401 && d.peer && !ident.includes('@') && !(await d.users.findByHandleOrDid(ident))) {
        const peerDid = await d.peer.resolve(ident).catch(() => null)
        if (peerDid) {
          return c.json(
            { error: 'WrongContour', message: 'Ваш аккаунт обслуживает другой узел Indie.media — продолжите вход там.', redirect: `${d.peer.publicUrl}/login` },
            409,
          )
        }
      }
      throw err
    }
    // аккаунт мог появиться в PDS в обход AppView (миграция): заводим запись, страна — текущая
    const user =
      (await d.users.findByDid(session.did)) ??
      (await d.users.insert({ did: session.did, handle: session.handle, signupCountry: geo.country }))
    // перезапись секретов привязок — только после второго фактора, если он включён
    if (!user.password_login) {
      if ((await d.mfa.get(user.did)).totpEnabledAt) {
        if (pendingAdopt.size > 10_000) pendingAdopt.clear()
        pendingAdopt.add(session.accessJwt)
      }
      else await adoptPassword(user, session.accessJwt)
    }
    return c.json(await mfaGate.gate(sessionDto(session, { ...user, password_login: true })))
  })

  app.post('/auth/refresh', async (c) => {
    const body = RefreshBody.safeParse(await c.req.json().catch(() => null))
    if (!body.success) return c.json({ error: 'InvalidRequest', message: 'refreshJwt required' }, 400)
    const session = await d.pds.refreshSession(body.data.refreshJwt)
    const user = await d.users.findByDid(session.did)
    if (!user) return c.json({ error: 'NotFound', message: 'Пользователь не найден' }, 404)
    // refresh-токен из прямого входа в PDS второй фактор не проходил
    if ((await d.mfa.get(user.did)).totpEnabledAt) {
      if (!(await d.mfa.isSessionMarked(tokenHash(body.data.refreshJwt)))) {
        return c.json({ error: 'MfaRequired', message: 'Войдите заново: нужен код из приложения-аутентификатора' }, 401)
      }
      await d.mfa.markSessions(user.did, [tokenHash(session.accessJwt), tokenHash(session.refreshJwt)], MFA_SESSION_TTL)
    }
    return c.json(sessionDto(session, user))
  })

  /** DID владельца access-токена (проверяет PDS) или null */
  const authDid = async (c: Context): Promise<string | null> => {
    const token = bearer(c)
    if (!token) return null
    return (await d.pds.getSession(token)).did
  }
  const unauthorized = (c: Context) =>
    c.json({ error: 'AuthenticationRequired', message: 'Нужен Bearer-токен' }, 401)

  app.get('/me', async (c) => {
    const did = await authDid(c)
    if (!did) return unauthorized(c)
    const user = await d.users.findByDid(did)
    if (!user) return c.json({ error: 'NotFound', message: 'Пользователь не найден' }, 404)
    return c.json(toSelf(user))
  })

  app.get('/me/settings', async (c) => {
    const did = await authDid(c)
    if (!did) return unauthorized(c)
    return c.json(await d.settings.get(did))
  })

  app.patch('/me/settings', async (c) => {
    const did = await authDid(c)
    if (!did) return unauthorized(c)
    const body = SettingsPatch.safeParse(await c.req.json().catch(() => null))
    if (!body.success) return c.json({ error: 'InvalidRequest', message: z.prettifyError(body.error) }, 400)
    const user = await d.users.findByDid(did)
    if (!user) return c.json({ error: 'NotFound', message: 'Пользователь не найден' }, 404)
    // свои блоки — платная функция: без Premium сохранить шаблоны нельзя (пустой список можно)
    if (body.data.blockDefs?.length && user.tier !== 'premium') {
      return c.json({ error: 'PremiumRequired', message: 'Свои блоки доступны в Premium' }, 403)
    }
    return c.json(await d.settings.merge(did, body.data))
  })

  app.get('/users/:id', async (c) => {
    const user = await d.users.findByHandleOrDid(c.req.param('id'))
    if (!user) return c.json({ error: 'NotFound', message: 'Пользователь не найден' }, 404)
    // число платных подписчиков публично, кто именно подписан — нет
    return c.json({ ...toPublic(user), paidSubscribers: await d.paid.countSubscribers(user.did) })
  })

  app.put('/admin/users/:did/tier', async (c) => {
    const staff = await requireStaff(c, 'admin')
    const body = TierBody.safeParse(await c.req.json().catch(() => null))
    if (!body.success) return c.json({ error: 'InvalidRequest', message: "tier: 'free' | 'premium'" }, 400)
    const user = await d.users.setTier(c.req.param('did'), body.data.tier)
    if (!user) return c.json({ error: 'NotFound', message: 'Пользователь не найден' }, 404)
    await audit(staff, 'user.tier', user.did, { tier: body.data.tier })
    return c.json(toPublic(user))
  })

  /** страна резидентства — по заявке из поддержки, после проверки документа; в аудит */
  app.put('/admin/users/:did/residence', async (c) => {
    const staff = await requireStaff(c, 'support')
    const body = ResidenceBody.safeParse(await c.req.json().catch(() => null))
    if (!body.success) return c.json({ error: 'InvalidRequest', message: 'country: ISO 3166-1 alpha-2, например RU' }, 400)
    const before = await d.users.findByDid(c.req.param('did'))
    if (!before) return c.json({ error: 'NotFound', message: 'Пользователь не найден' }, 404)
    const from = before.residence_country ?? before.signup_country
    const user = (await d.users.setResidence(before.did, body.data.country))!
    await audit(staff, 'user.residence', user.did, { from, to: body.data.country, ticket: body.data.ticket })
    return c.json(toSelf(user))
  })

  return app
}
