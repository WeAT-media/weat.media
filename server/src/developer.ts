import { sourceOf } from './articles.js'
import { createHash, randomBytes } from 'node:crypto'
import type { Context, Hono } from 'hono'
import { z } from 'zod'
import { profileOps } from './profile.js'
import type { Sql, UserRepo, UserRow } from './db.js'
import { PdsError, type PdsClient } from './pds.js'
import type { DraftRepo } from './drafts.js'
import type { SecretBox } from './secretbox.js'
import { ARTICLE_COLLECTION } from './paidContent.js'

/**
 * Разработчикам:
 *  - персональные токены (wm_pat_…) — публикация в weat.media из скриптов и CI;
 *  - OAuth-приложения — регистрация клиента для «Войти через weat.media» (OIDC).
 * Токен и секрет клиента видны один раз; в БД — только sha256.
 */

export const SCOPES = ['articles:write', 'articles:delete', 'comments:read', 'comments:write', 'profile:read', 'profile:update'] as const
export const COMMENT_COLLECTION = 'media.weat.comment'
const PROFILE_COLLECTION = 'app.bsky.actor.profile'
export type Scope = (typeof SCOPES)[number]

export interface PersonalTokenRow {
  id: string
  did: string
  name: string
  token_hash: string
  scopes: Scope[]
  app_password_name: string
  app_password_enc: string
  created_at: Date
  expires_at: Date | null
  last_used_at: Date | null
}

export interface OAuthClientRow {
  client_id: string
  owner_did: string
  name: string
  homepage_url: string
  redirect_uris: string[]
  secret_hash: string
  created_at: Date
  secret_rotated_at: Date
}

export interface DeveloperRepo {
  insertToken(r: Omit<PersonalTokenRow, 'created_at' | 'last_used_at'>): Promise<void>
  tokensOf(did: string): Promise<PersonalTokenRow[]>
  tokenByHash(hash: string): Promise<PersonalTokenRow | undefined>
  touchToken(id: string): Promise<void>
  removeToken(did: string, id: string): Promise<PersonalTokenRow | undefined>
  /** новый секрет на место старого (старый перестаёт работать сразу); expiresAt — новый срок */
  rotateToken(did: string, id: string, hash: string, expiresAt: Date | null): Promise<PersonalTokenRow | undefined>
  /** токен отзывает сам себя: перестаёт работать сразу, app password отзовётся при визите владельца */
  expireToken(id: string): Promise<void>
  insertClient(r: Omit<OAuthClientRow, 'created_at' | 'secret_rotated_at'>): Promise<void>
  clientsOf(did: string): Promise<OAuthClientRow[]>
  updateClient(did: string, id: string, patch: Partial<Pick<OAuthClientRow, 'name' | 'homepage_url' | 'redirect_uris' | 'secret_hash'>>): Promise<OAuthClientRow | undefined>
  removeClient(did: string, id: string): Promise<boolean>
}

export function developerRepo(sql: Sql): DeveloperRepo {
  return {
    async insertToken(r) {
      await sql`
        INSERT INTO personal_tokens (id, did, name, token_hash, scopes, app_password_name, app_password_enc, expires_at)
        VALUES (${r.id}, ${r.did}, ${r.name}, ${r.token_hash}, ${r.scopes}, ${r.app_password_name}, ${r.app_password_enc}, ${r.expires_at})`
    },
    tokensOf(did) {
      return sql<PersonalTokenRow[]>`SELECT * FROM personal_tokens WHERE did = ${did} ORDER BY created_at DESC`
    },
    async tokenByHash(hash) {
      const [row] = await sql<PersonalTokenRow[]>`SELECT * FROM personal_tokens WHERE token_hash = ${hash}`
      return row
    },
    async touchToken(id) {
      await sql`UPDATE personal_tokens SET last_used_at = now() WHERE id = ${id}`
    },
    async removeToken(did, id) {
      const [row] = await sql<PersonalTokenRow[]>`DELETE FROM personal_tokens WHERE did = ${did} AND id = ${id} RETURNING *`
      return row
    },
    async rotateToken(did, id, hash, expiresAt) {
      const [row] = await sql<PersonalTokenRow[]>`
        UPDATE personal_tokens SET token_hash = ${hash}, expires_at = ${expiresAt}, last_used_at = NULL
        WHERE did = ${did} AND id = ${id} AND (expires_at IS NULL OR expires_at > now()) RETURNING *`
      return row
    },
    async expireToken(id) {
      await sql`UPDATE personal_tokens SET expires_at = now() WHERE id = ${id}`
    },
    async insertClient(r) {
      await sql`
        INSERT INTO oauth_clients (client_id, owner_did, name, homepage_url, redirect_uris, secret_hash)
        VALUES (${r.client_id}, ${r.owner_did}, ${r.name}, ${r.homepage_url}, ${r.redirect_uris}, ${r.secret_hash})`
    },
    clientsOf(did) {
      return sql<OAuthClientRow[]>`SELECT * FROM oauth_clients WHERE owner_did = ${did} ORDER BY created_at DESC`
    },
    async updateClient(did, id, p) {
      const [row] = await sql<OAuthClientRow[]>`
        UPDATE oauth_clients SET
          name = COALESCE(${p.name ?? null}, name),
          homepage_url = COALESCE(${p.homepage_url ?? null}, homepage_url),
          redirect_uris = COALESCE(${p.redirect_uris ?? null}, redirect_uris),
          secret_hash = COALESCE(${p.secret_hash ?? null}, secret_hash),
          secret_rotated_at = CASE WHEN ${p.secret_hash ?? null}::text IS NULL THEN secret_rotated_at ELSE now() END
        WHERE owner_did = ${did} AND client_id = ${id} RETURNING *`
      return row
    },
    async removeClient(did, id) {
      const rows = await sql`DELETE FROM oauth_clients WHERE owner_did = ${did} AND client_id = ${id} RETURNING 1`
      return rows.length > 0
    },
  }
}

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex')

export const CreateTokenBody = z.object({
  name: z.string().trim().min(1).max(64),
  scopes: z.array(z.enum(SCOPES)).min(1).max(SCOPES.length),
  expiresInDays: z.union([z.literal(7), z.literal(30), z.literal(90), z.literal(365), z.null()]).default(90).describe('null — бессрочно'),
})

/** https везде; http — только для локальной разработки */
const RedirectUri = z.url().refine((u) => {
  const { protocol, hostname } = new URL(u)
  return protocol === 'https:' || (protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(hostname))
}, 'redirect URI — https:// (http:// только для localhost)')

export const RotateTokenBody = z.object({
  expiresInDays: z.union([z.literal(7), z.literal(30), z.literal(90), z.literal(365), z.null()]).optional().describe('не задан — прежняя длительность; null — бессрочно'),
})

export const CreateClientBody = z.object({
  name: z.string().trim().min(1).max(80),
  homepageUrl: z.url(),
  redirectUris: z.array(RedirectUri).min(1).max(10),
})
export const UpdateClientBody = CreateClientBody.partial()

export const ApiDraftBody = z.object({
  title: z.string().trim().min(1).max(300),
  subtitle: z.string().trim().max(300).optional(),
  text: z.string().max(200_000).describe('Markdown — формат как у статьи (раздел «Формат текста статьи»); заголовок не дублируйте, он в title'),
  tags: z.array(z.string().trim().min(1).max(64)).max(20).default([]),
  langs: z.array(z.string().regex(/^[a-z]{2}(-[A-Za-z]{2})?$/)).max(3).default([]),
  canonicalUrl: z.string().url().max(2000).optional().describe('оригинал (при переносе) — в черновике станет «Перепечаткой»'),
  originalPublishedAt: z.string().datetime({ offset: true }).refine((v) => Date.parse(v) <= Date.now() + 5 * 60_000, 'не может быть в будущем').optional().describe('когда статья впервые вышла в оригинале'),
})

export const ApiArticleBody = z.object({
  title: z.string().trim().min(1).max(300),
  text: z.string().min(1).max(200_000).describe('Markdown (формат — раздел «Формат текста статьи» на weat.media/api): ## и ### заголовки, абзацы, списки - и 1., > цитаты, ``` код, **жирный**, *курсив*, ~~зачёркнутый~~, <u>подчёркнутый</u>, [ссылка](https://…), ![картинка](https://…); свои блоки — фенсы с JSON: ```faq, ```button, ```poll, ```bookmark, ```callout, ```carousel.'),
  excerpt: z.string().trim().max(500).optional(),
  tags: z.array(z.string().trim().min(1).max(64)).max(20).default([]),
  langs: z.array(z.string().regex(/^[a-z]{2}(-[A-Za-z]{2})?$/)).max(3).default([]),
  canonicalUrl: z.url().optional().describe('Оригинал, если статья уже опубликована где-то ещё (перепечатка)'),
  originalPublishedAt: z.string().datetime({ offset: true }).refine((v) => Date.parse(v) <= Date.now() + 5 * 60_000, 'не может быть в будущем').optional().describe('когда статья впервые вышла в оригинале'),
})

const AtUri = z.string().regex(/^at:\/\/did:[a-z]+:[A-Za-z0-9._:%-]+\/[a-zA-Z0-9.-]+\/[A-Za-z0-9._~:-]+$/, 'нужен at://did/коллекция/rkey')

export const ApiCommentBody = z.object({
  subject: AtUri.describe('at://… статьи'),
  parent: AtUri.optional().describe('at://… комментария, на который отвечаем'),
  text: z.string().trim().min(1).max(10_000),
})

export const ApiProfileBody = z
  .object({
    displayName: z.string().trim().min(1).max(64).nullable().optional(),
    description: z.string().trim().max(256).nullable().optional(),
  })
  .refine((b) => b.displayName !== undefined || b.description !== undefined, 'нужно displayName или description')

export const TokenDto = z.object({
  id: z.string(),
  name: z.string(),
  scopes: z.array(z.enum(SCOPES)),
  createdAt: z.string(),
  expiresAt: z.string().nullable(),
  lastUsedAt: z.string().nullable(),
})
export const ClientDto = z.object({
  clientId: z.string(),
  name: z.string(),
  homepageUrl: z.string(),
  redirectUris: z.array(z.string()),
  createdAt: z.string(),
  secretRotatedAt: z.string(),
})

const tokenDto = (r: PersonalTokenRow): z.infer<typeof TokenDto> => ({
  id: r.id,
  name: r.name,
  scopes: r.scopes,
  createdAt: r.created_at.toISOString(),
  expiresAt: r.expires_at?.toISOString() ?? null,
  lastUsedAt: r.last_used_at?.toISOString() ?? null,
})
const clientDto = (r: OAuthClientRow): z.infer<typeof ClientDto> => ({
  clientId: r.client_id,
  name: r.name,
  homepageUrl: r.homepage_url,
  redirectUris: r.redirect_uris,
  createdAt: r.created_at.toISOString(),
  secretRotatedAt: r.secret_rotated_at.toISOString(),
})

export interface DeveloperDeps {
  users: UserRepo
  pds: PdsClient
  developer: DeveloperRepo
  secrets: SecretBox
  /** черновики — для POST /v1/drafts (перенос статей черновиками) */
  drafts?: DraftRepo
}

const fail = (code: string, message: string, status: 400 | 401 | 403 | 404) => new PdsError(status, code, message)
const MAX_TOKENS = 20
const MAX_CLIENTS = 10

export function mountDeveloperRoutes(app: Hono, d: DeveloperDeps, h: { bearer(c: Context): string | undefined }) {
  /** обычная сессия PDS владельца (управление токенами — только из интерфейса, не токеном) */
  const owner = async (c: Context): Promise<{ user: UserRow; token: string }> => {
    const token = h.bearer(c)
    if (!token) throw fail('AuthenticationRequired', 'Нужно войти', 401)
    if (token.startsWith('wm_pat_')) throw fail('Forbidden', 'Персональным токеном нельзя управлять токенами', 403)
    const { did } = await d.pds.getSession(token)
    const user = await d.users.findByDid(did)
    if (!user) throw fail('NotFound', 'Пользователь не найден', 404)
    return { user, token }
  }
  const parse = async <T extends z.ZodType>(c: Context, schema: T): Promise<z.infer<T>> => {
    const r = schema.safeParse(await c.req.json().catch(() => null))
    if (!r.success) throw fail('InvalidRequest', z.prettifyError(r.error), 400)
    return r.data
  }

  // ── персональные токены
  app.get('/me/tokens', async (c) => {
    const { user, token: jwt } = await owner(c)
    // app password отзывается только полной сессией владельца — чистим истёкшие здесь
    const now = new Date()
    const rows = await d.developer.tokensOf(user.did)
    for (const r of rows.filter((x) => x.expires_at && x.expires_at <= now)) {
      await d.pds.revokeAppPassword(jwt, r.app_password_name).catch(() => {})
      await d.developer.removeToken(user.did, r.id)
    }
    return c.json(rows.filter((x) => !x.expires_at || x.expires_at > now).map(tokenDto))
  })

  app.post('/me/tokens', async (c) => {
    const { user, token: jwt } = await owner(c)
    const b = await parse(c, CreateTokenBody)
    if ((await d.developer.tokensOf(user.did)).length >= MAX_TOKENS) throw fail('InvalidRequest', `Не больше ${MAX_TOKENS} токенов`, 400)
    const id = `pat_${randomBytes(6).toString('hex')}`
    const secret = `wm_pat_${randomBytes(32).toString('base64url')}`
    // app password на PDS: отзыв токена отзывает и доступ к репозиторию
    const appName = `weat-${id}`
    const { password } = await d.pds.createAppPassword(jwt, appName)
    const row = {
      id,
      did: user.did,
      name: b.name,
      token_hash: sha256(secret),
      scopes: b.scopes,
      app_password_name: appName,
      app_password_enc: d.secrets.seal(password),
      expires_at: b.expiresInDays ? new Date(Date.now() + b.expiresInDays * 86_400_000) : null,
    }
    await d.developer.insertToken(row)
    return c.json({ ...tokenDto({ ...row, created_at: new Date(), last_used_at: null }), token: secret }, 201)
  })

  /** ротация: тот же токен (имя, права, доступ к репозиторию), новое значение; старое не работает сразу */
  app.post('/me/tokens/:id/rotate', async (c) => {
    const { user } = await owner(c)
    const b = await parse(c, RotateTokenBody)
    const current = (await d.developer.tokensOf(user.did)).find((t) => t.id === c.req.param('id'))
    if (!current) throw fail('NotFound', 'Токен не найден', 404)
    // срок: новый, если задан; иначе прежняя длительность от текущего момента
    const days =
      b.expiresInDays !== undefined
        ? b.expiresInDays
        : current.expires_at
          ? Math.max(1, Math.round((current.expires_at.getTime() - current.created_at.getTime()) / 86_400_000))
          : null
    const secret = `wm_pat_${randomBytes(32).toString('base64url')}`
    const row = await d.developer.rotateToken(user.did, current.id, sha256(secret), days ? new Date(Date.now() + days * 86_400_000) : null)
    if (!row) throw fail('NotFound', 'Токен истёк — выпустите новый', 404)
    return c.json({ ...tokenDto(row), token: secret })
  })

  app.delete('/me/tokens/:id', async (c) => {
    const { user, token: jwt } = await owner(c)
    const row = await d.developer.removeToken(user.did, c.req.param('id'))
    if (!row) throw fail('NotFound', 'Токен не найден', 404)
    await d.pds.revokeAppPassword(jwt, row.app_password_name).catch(() => {})
    return c.json({ ok: true })
  })

  // ── OAuth-приложения
  app.get('/me/oauth-apps', async (c) => {
    const { user } = await owner(c)
    return c.json((await d.developer.clientsOf(user.did)).map(clientDto))
  })

  app.post('/me/oauth-apps', async (c) => {
    const { user } = await owner(c)
    const b = await parse(c, CreateClientBody)
    if ((await d.developer.clientsOf(user.did)).length >= MAX_CLIENTS) throw fail('InvalidRequest', `Не больше ${MAX_CLIENTS} приложений`, 400)
    const clientId = `wm_app_${randomBytes(9).toString('base64url')}`
    const clientSecret = `wm_cs_${randomBytes(32).toString('base64url')}`
    const row = { client_id: clientId, owner_did: user.did, name: b.name, homepage_url: b.homepageUrl, redirect_uris: b.redirectUris, secret_hash: sha256(clientSecret) }
    await d.developer.insertClient(row)
    const now = new Date()
    return c.json({ ...clientDto({ ...row, created_at: now, secret_rotated_at: now }), clientSecret }, 201)
  })

  app.patch('/me/oauth-apps/:id', async (c) => {
    const { user } = await owner(c)
    const b = await parse(c, UpdateClientBody)
    const row = await d.developer.updateClient(user.did, c.req.param('id'), { name: b.name, homepage_url: b.homepageUrl, redirect_uris: b.redirectUris })
    if (!row) throw fail('NotFound', 'Приложение не найдено', 404)
    return c.json(clientDto(row))
  })

  app.post('/me/oauth-apps/:id/secret', async (c) => {
    const { user } = await owner(c)
    const clientSecret = `wm_cs_${randomBytes(32).toString('base64url')}`
    const row = await d.developer.updateClient(user.did, c.req.param('id'), { secret_hash: sha256(clientSecret) })
    if (!row) throw fail('NotFound', 'Приложение не найдено', 404)
    return c.json({ ...clientDto(row), clientSecret })
  })

  app.delete('/me/oauth-apps/:id', async (c) => {
    const { user } = await owner(c)
    if (!(await d.developer.removeClient(user.did, c.req.param('id')))) throw fail('NotFound', 'Приложение не найдено', 404)
    return c.json({ ok: true })
  })

  // ── публичный API по персональному токену
  const byToken = async (c: Context, scope: Scope) => {
    const secret = h.bearer(c)
    if (!secret?.startsWith('wm_pat_')) throw fail('AuthenticationRequired', 'Нужен персональный токен: Authorization: Bearer wm_pat_…', 401)
    const row = await d.developer.tokenByHash(sha256(secret))
    if (!row) throw fail('InvalidToken', 'Токен недействителен или истёк', 401)
    if (row.expires_at && row.expires_at <= new Date()) {
      // истёк: токен больше не работает; app password на PDS отзовётся при следующем открытии
      // списка токенов владельцем (нужна его полная сессия)
      throw fail('InvalidToken', 'Токен недействителен или истёк', 401)
    }
    if (!row.scopes.includes(scope)) throw fail('Forbidden', `У токена нет права ${scope}`, 403)
    const user = await d.users.findByDid(row.did)
    if (!user) throw fail('InvalidToken', 'Аккаунт удалён', 401)
    await d.developer.touchToken(row.id)
    return { row, user }
  }
  const pdsSession = async (row: PersonalTokenRow, user: UserRow) => {
    try {
      return await d.pds.createSession(user.did, d.secrets.open(row.app_password_enc))
    } catch {
      throw fail('InvalidToken', 'Доступ к репозиторию отозван — выпустите токен заново', 401)
    }
  }

  /** отзыв самим токеном — например, при утечке из CI, когда под рукой только токен */
  app.delete('/v1/token', async (c) => {
    const secret = h.bearer(c)
    if (!secret?.startsWith('wm_pat_')) throw fail('AuthenticationRequired', 'Нужен персональный токен: Authorization: Bearer wm_pat_…', 401)
    const row = await d.developer.tokenByHash(sha256(secret))
    if (row && (!row.expires_at || row.expires_at > new Date())) await d.developer.expireToken(row.id)
    // одинаковый ответ: не подсказываем, был ли такой токен
    return c.json({ ok: true })
  })

  app.get('/v1/me', async (c) => {
    const { user } = await byToken(c, 'profile:read')
    return c.json({ did: user.did, handle: user.handle, displayName: user.display_name })
  })

  /** профиль: имя в AppView и в AT-записи app.bsky.actor.profile (аватар и прочие поля сохраняются) */
  app.patch('/v1/me', async (c) => {
    const { row, user } = await byToken(c, 'profile:update')
    const b = await parse(c, ApiProfileBody)
    const s = await pdsSession(row, user)
    const current = (await d.pds.getRecord(user.did, PROFILE_COLLECTION, 'self')) ?? {}
    const next: Record<string, unknown> = { ...current, $type: PROFILE_COLLECTION }
    for (const [k, v] of Object.entries(b)) {
      if (v === undefined) continue
      if (v === null) delete next[k]
      else next[k] = v
    }
    await d.pds.putRecord(s.accessJwt, user.did, PROFILE_COLLECTION, 'self', next)
    if (b.displayName !== undefined) await d.users.setDisplayName(user.did, b.displayName)
    return c.json({ did: user.did, handle: user.handle, displayName: (next.displayName as string | undefined) ?? null, description: (next.description as string | undefined) ?? null })
  })

  /** аватар по API: тело — файл PNG/JPEG/WebP до 1 МБ (profile.ts) */
  app.post('/v1/me/avatar', async (c) => {
    const { row, user } = await byToken(c, 'profile:update')
    const file = new Uint8Array(await c.req.arrayBuffer())
    if (!file.byteLength) throw fail('InvalidRequest', 'Тело запроса — файл картинки', 400)
    const s = await pdsSession(row, user)
    return c.json(await profileOps({ pds: d.pds, users: d.users }).setAvatar(s.accessJwt, user.did, file))
  })

  app.delete('/v1/me/avatar', async (c) => {
    const { row, user } = await byToken(c, 'profile:update')
    const s = await pdsSession(row, user)
    return c.json(await profileOps({ pds: d.pds, users: d.users }).setAvatar(s.accessJwt, user.did, null))
  })

  /** свои комментарии из репозитория (индекса чужих комментариев пока нет) */
  app.get('/v1/me/comments', async (c) => {
    const { user } = await byToken(c, 'comments:read')
    const limit = Math.min(100, Math.max(1, Number(c.req.query('limit')) || 50))
    const r = await d.pds.listRecords(user.did, COMMENT_COLLECTION, limit, c.req.query('cursor') || undefined)
    return c.json({ comments: r.records.map((x) => ({ uri: x.uri, cid: x.cid, ...x.value })), ...(r.cursor ? { cursor: r.cursor } : {}) })
  })

  app.post('/v1/comments', async (c) => {
    const { row, user } = await byToken(c, 'comments:write')
    const b = await parse(c, ApiCommentBody)
    const s = await pdsSession(row, user)
    const record = {
      $type: COMMENT_COLLECTION,
      subject: { uri: b.subject },
      ...(b.parent ? { reply: { parent: { uri: b.parent } } } : {}),
      text: b.text,
      createdAt: new Date().toISOString(),
    }
    const { uri, cid } = await d.pds.createRecord(s.accessJwt, user.did, COMMENT_COLLECTION, record)
    return c.json({ uri, cid }, 201)
  })

  app.delete('/v1/comments/:rkey', async (c) => {
    const { row, user } = await byToken(c, 'comments:write')
    const s = await pdsSession(row, user)
    await d.pds.deleteRecord(s.accessJwt, user.did, COMMENT_COLLECTION, c.req.param('rkey'))
    return c.json({ ok: true })
  })

  app.post('/v1/articles', async (c) => {
    const { row, user } = await byToken(c, 'articles:write')
    const b = await parse(c, ApiArticleBody)
    const s = await pdsSession(row, user)
    const record = {
      $type: ARTICLE_COLLECTION,
      title: b.title,
      text: b.text,
      excerpt: b.excerpt ?? b.text.slice(0, 500),
      tags: b.tags,
      ...(b.langs.length ? { langs: b.langs } : {}),
      ...(b.canonicalUrl ? { source: sourceOf(b.canonicalUrl, b.originalPublishedAt) } : {}),
      createdAt: new Date().toISOString(),
    }
    const { uri, cid } = await d.pds.createRecord(s.accessJwt, user.did, ARTICLE_COLLECTION, record)
    return c.json({ uri, cid }, 201)
  })

  // черновик по токену: перенос статей с других площадок — автор вычитает их в редакторе и опубликует сам.
  // В репозиторий (он публичен) не пишется; виден только автору: «Настройки → Черновики», /compose?draft=<id>
  app.post('/v1/drafts', async (c) => {
    if (!d.drafts) throw fail('NotConfigured', 'Черновики недоступны', 404)
    const { user } = await byToken(c, 'articles:write')
    const b = await parse(c, ApiDraftBody)
    if ((await d.drafts.count(user.did)) >= 200) throw new PdsError(409, 'TooManyDrafts', 'Черновиков больше 200 — удалите ненужные')
    const id = `dr_${randomBytes(9).toString('base64url')}`
    // заголовок — первой строкой «# …»: так его показывает редактор
    const text = `# ${b.title}\n\n${b.text}`
    const meta = {
      ...(b.subtitle ? { subtitle: b.subtitle } : {}),
      ...(b.tags.length ? { tags: b.tags } : {}),
      ...(b.langs[0] ? { language: b.langs[0] } : {}),
      ...(b.canonicalUrl ? { canonicalUrl: b.canonicalUrl } : {}),
      ...(b.originalPublishedAt ? { originalPublishedAt: b.originalPublishedAt } : {}),
    }
    const r = await d.drafts.save(user.did, id, b.title, text, meta)
    return c.json({ id: r.id, editUrl: `/compose?draft=${r.id}`, createdAt: r.created_at.toISOString() }, 201)
  })

  app.delete('/v1/articles/:rkey', async (c) => {
    const { row, user } = await byToken(c, 'articles:delete')
    const s = await pdsSession(row, user)
    await d.pds.deleteRecord(s.accessJwt, user.did, ARTICLE_COLLECTION, c.req.param('rkey'))
    return c.json({ ok: true })
  })
}
