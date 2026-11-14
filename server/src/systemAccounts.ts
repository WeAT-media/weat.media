import { randomBytes } from 'node:crypto'
import type { Context, Hono } from 'hono'
import { z } from 'zod'
import type { Sql, UserRepo, UserRow } from './db.js'
import { PdsError, type PdsClient, type PdsSession } from './pds.js'
import type { SecretBox } from './secretbox.js'
import type { Staff, StaffRole } from './staff.js'

/**
 * Системные учётки (news — обновления площадки, crawler — служебная, justice — новости коллегий, свои — по кнопке):
 * обычные аккаунты на нашем PDS с отметкой users.service = 'system'. Пароль знает только сервер (зашифрован).
 * Сотрудник admin входит в такую учётку из админки и пишет обычным редактором; в человека так войти нельзя.
 */

export interface SystemAccountRepo {
  insert(did: string, passwordEnc: string, createdBy: string): Promise<void>
  password(did: string): Promise<string | undefined>
}

export function systemAccountRepo(sql: Sql): SystemAccountRepo {
  return {
    async insert(did, passwordEnc, createdBy) {
      await sql`INSERT INTO system_accounts (did, password_enc, created_by) VALUES (${did}, ${passwordEnc}, ${createdBy})
                ON CONFLICT (did) DO UPDATE SET password_enc = EXCLUDED.password_enc`
    },
    async password(did) {
      const [r] = await sql<{ password_enc: string }[]>`SELECT password_enc FROM system_accounts WHERE did = ${did}`
      return r?.password_enc
    },
  }
}

export const SystemAccountBody = z.object({
  username: z.string().trim().toLowerCase().regex(/^[a-z][a-z0-9-]{1,28}[a-z0-9]$/, 'латиница, цифры и дефис, 3–30 символов'),
  displayName: z.string().trim().min(2).max(64),
  description: z.string().trim().max(256).optional(),
})

const fail = (code: string, message: string, status: 400 | 404 | 409 = 400) => new PdsError(status, code, message)

export function mountSystemAccountRoutes<Body>(
  app: Hono,
  d: { pds: PdsClient; users: UserRepo; system: SystemAccountRepo; secrets: SecretBox; handleDomain: string },
  h: {
    requireStaff(c: Context, role: StaffRole): Promise<Staff | 'break-glass'>
    audit(who: Staff | 'break-glass', action: string, target: string | null, details?: Record<string, unknown>): Promise<void>
    issueHandoff(body: Body): string
    sessionDto(s: PdsSession, user: UserRow): Body
  },
) {
  const actor = (s: Staff | 'break-glass') => (s === 'break-glass' ? 'break-glass' : `zitadel:${s.sub}`)

  app.get('/admin/system-accounts', async (c) => {
    await h.requireStaff(c, 'admin')
    c.header('cache-control', 'private, no-store')
    const rows = await d.users.search('', 200, { service: true })
    return c.json(
      await Promise.all(
        rows.map(async (u) => ({ did: u.did, handle: u.handle, displayName: u.display_name, service: u.service, canLogin: !!(await d.system.password(u.did)), createdAt: u.created_at.toISOString() })),
      ),
    )
  })

  app.post('/admin/system-accounts', async (c) => {
    const staff = await h.requireStaff(c, 'admin')
    const body = SystemAccountBody.safeParse(await c.req.json().catch(() => null))
    if (!body.success) throw fail('InvalidRequest', z.prettifyError(body.error))
    const { username, displayName, description } = body.data
    const handle = `${username}.${d.handleDomain}`
    if (await d.users.findByHandleOrDid(handle)) throw fail('HandleTaken', 'Такой handle уже занят', 409)
    const password = randomBytes(24).toString('base64url')
    // создаём под временным handle: news, crawler и т. п. PDS считает зарезервированными — их ставит admin API
    const session = await d.pds.createAccount({ handle: `${username}-${randomBytes(3).toString('hex')}.${d.handleDomain}`, email: `system+${username}@${d.handleDomain}`, password })
    await d.pds.adminUpdateHandle(session.did, handle)
    const user = await d.users.insert({ did: session.did, handle, displayName, signupCountry: 'ZZ', passwordLogin: false })
    await d.users.setService(session.did, 'system')
    await d.system.insert(session.did, d.secrets.seal(password), actor(staff))
    const fresh = await d.pds.createSession(session.did, password)
    await d.pds.putRecord(fresh.accessJwt, session.did, 'app.bsky.actor.profile', 'self', {
      $type: 'app.bsky.actor.profile',
      displayName,
      ...(description ? { description } : {}),
    })
    await h.audit(staff, 'system.create', session.did, { handle })
    return c.json({ did: user.did, handle, displayName, service: 'system' }, 201)
  })

  /** «Войти как»: одноразовый код входа для /login?handoff=… — дальше обычный сценарий автора */
  app.post('/admin/system-accounts/:did/login', async (c) => {
    const staff = await h.requireStaff(c, 'admin')
    const user = await d.users.findByDid(c.req.param('did'))
    if (!user?.service) throw fail('NotFound', 'Системная учётка не найдена', 404)
    const enc = await d.system.password(user.did)
    if (!enc) throw fail('NotFound', 'У этой учётки нет пароля на сервере — вход недоступен', 404)
    const session = await d.pds.createSession(user.did, d.secrets.open(enc))
    await h.audit(staff, 'system.login', user.did, { handle: user.handle })
    c.header('cache-control', 'no-store')
    return c.json({ code: h.issueHandoff(h.sessionDto(session, user)) })
  })
}
