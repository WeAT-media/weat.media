import { createHash } from 'node:crypto'
import type { Context, Hono } from 'hono'
import { z } from 'zod'
import type { MfaRepo, UserRepo, UserRow } from './db.js'
import { PdsError, type PdsClient } from './pds.js'
import { CodeBody, ConfirmEmailBody, Email2faBody, ForgotPasswordBody, MfaBody, PasswordChangeBody, ResetPasswordBody } from './schemas.js'
import type { SecretBox } from './secretbox.js'
import { hashBackupCode, newBackupCodes, newTotpSecret, otpauthUrl, totpStep } from './totp.js'

export interface SecurityDeps {
  users: UserRepo
  mfa: MfaRepo
  pds: PdsClient
  secrets: SecretBox
}

type SessionBody = { accessJwt: string; refreshJwt: string; user: { did: string } }
export type Gated = SessionBody | { mfaRequired: 'totp'; mfaToken: string }

const MFA_TTL = 5 * 60_000
/** отметка «прошёл TOTP» живёт столько же, сколько refresh-токен PDS */
export const MFA_SESSION_TTL = 90 * 86_400_000
/** перебор кода: 10 неверных за 15 минут — блокировка второго шага на 15 минут (по аккаунту) */
const MAX_FAILURES = 10
const FAIL_WINDOW = 15 * 60_000
const LOCK_FOR = 15 * 60_000

export const tokenHash = (t: string) => createHash('sha256').update(t).digest('hex')
const fail = (code: string, message: string, status: 400 | 401 | 403 | 404 | 409 = 400) => new PdsError(status, code, message)

export function createMfaGate(d: SecurityDeps) {
  return {
    /** вход через любой способ: при включённом TOTP сессия выдаётся только после кода */
    async gate(body: SessionBody): Promise<Gated> {
      const mfa = await d.mfa.get(body.user.did)
      if (!mfa.totpEnabledAt) return body
      const mfaToken = d.secrets.seal(JSON.stringify({ body, exp: Date.now() + MFA_TTL }))
      return { mfaRequired: 'totp', mfaToken }
    },
  }
}

export function mountSecurityRoutes(
  app: Hono,
  d: SecurityDeps,
  h: { bearer(c: Context): string | undefined; afterMfa?(body: SessionBody): Promise<void> },
) {
  const requireUser = async (c: Context): Promise<{ user: UserRow; token: string }> => {
    const token = h.bearer(c)
    if (!token) throw fail('AuthenticationRequired', 'Нужно войти', 401)
    const { did } = await d.pds.getSession(token)
    const user = await d.users.findByDid(did)
    if (!user) throw fail('NotFound', 'Пользователь не найден', 404)
    return { user, token }
  }

  /** код из приложения (одноразовый по шагу) или резервный; неудачи копятся на аккаунт */
  const checkSecondFactor = async (did: string, code: string): Promise<boolean> => {
    const locked = await d.mfa.lockedUntil(did)
    if (locked) throw new PdsError(429, 'TooManyAttempts', `Слишком много неверных кодов. Повторите после ${locked.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}.`)
    const mfa = await d.mfa.get(did)
    if (!mfa.totpSecretEnc) return false
    let ok: boolean
    if (/^\d{6}$/.test(code)) {
      const step = totpStep(d.secrets.open(mfa.totpSecretEnc), code)
      ok = step !== null && (await d.mfa.useTotpStep(did, step))
    } else {
      ok = await d.mfa.consumeBackupCode(did, hashBackupCode(code))
    }
    if (ok) await d.mfa.resetFailures(did)
    else await d.mfa.recordFailure(did, MAX_FAILURES, FAIL_WINDOW, LOCK_FOR)
    return ok
  }

  const view = async (user: UserRow, token: string) => {
    const info = await d.pds.getSession(token)
    const mfa = await d.mfa.get(user.did)
    return {
      email: info.email ?? null,
      emailConfirmed: !!info.emailConfirmed,
      emailAuthFactor: !!info.emailAuthFactor,
      passwordLogin: user.password_login,
      totpEnabled: !!mfa.totpEnabledAt,
      backupCodesLeft: mfa.backupCodeHashes.length,
    }
  }

  const body = async <T extends z.ZodType>(c: Context, schema: T): Promise<z.infer<T>> => {
    const r = schema.safeParse(await c.req.json().catch(() => null))
    if (!r.success) throw fail('InvalidRequest', z.prettifyError(r.error))
    return r.data
  }

  // ── второй шаг входа ──────────────────────────────────────────────────
  app.post('/auth/mfa', async (c) => {
    const { mfaToken, code } = await body(c, MfaBody)
    const expired = () => fail('InvalidMfaToken', 'Сессия входа устарела. Войдите ещё раз.', 401)
    let saved: { body: SessionBody; exp: number }
    try {
      saved = JSON.parse(d.secrets.open(mfaToken))
    } catch {
      throw expired()
    }
    if (typeof saved?.exp !== 'number' || saved.exp < Date.now() || typeof saved.body?.user?.did !== 'string') throw expired()
    if (!(await checkSecondFactor(saved.body.user.did, code))) throw fail('InvalidCode', 'Неверный код', 401)
    // mfaToken одноразовый: повторно предъявить его нельзя
    if (!(await d.mfa.consumeMfaToken(tokenHash(mfaToken), new Date(saved.exp)))) throw expired()
    await d.mfa.markSessions(saved.body.user.did, [tokenHash(saved.body.accessJwt), tokenHash(saved.body.refreshJwt)], MFA_SESSION_TTL)
    await h.afterMfa?.(saved.body)
    return c.json(saved.body)
  })

  // ── восстановление доступа ────────────────────────────────────────────
  app.post('/auth/password/forgot', async (c) => {
    const { email } = await body(c, ForgotPasswordBody)
    // одинаковый ответ, есть аккаунт или нет: email не перебрать
    await d.pds.requestPasswordReset(email).catch(() => {})
    return c.json({ ok: true })
  })

  app.post('/auth/password/reset', async (c) => {
    const { token, password } = await body(c, ResetPasswordBody)
    try {
      await d.pds.resetPassword(token, password)
    } catch (err) {
      if (err instanceof PdsError && err.status < 500) throw fail('InvalidResetToken', 'Код неверный или устарел. Запросите новый.')
      throw err
    }
    return c.json({ ok: true })
  })

  // ── email ─────────────────────────────────────────────────────────────
  app.get('/me/security', async (c) => {
    const { user, token } = await requireUser(c)
    return c.json(await view(user, token))
  })

  app.post('/me/password/email/request', async (c) => {
    const { token } = await requireUser(c)
    const info = await d.pds.getSession(token)
    if (!info.email || !info.emailConfirmed) throw fail('EmailNotConfirmed', 'Сначала подтвердите email')
    await d.pds.requestPasswordReset(info.email)
    return c.json({ codeSent: true })
  })

  app.post('/me/password/change', async (c) => {
    const { user, token } = await requireUser(c)
    const { method, code, password } = await body(c, PasswordChangeBody)
    if (method === 'email') {
      const info = await d.pds.getSession(token)
      if (!info.email || !info.emailConfirmed) throw fail('EmailNotConfirmed', 'Сначала подтвердите email')
      try {
        await d.pds.resetPassword(code, password)
      } catch (err) {
        if (err instanceof PdsError && err.status < 500) throw fail('InvalidCode', 'Код неверный или устарел. Запросите новый.', 401)
        throw err
      }
    } else {
      if (!(await checkSecondFactor(user.did, code))) throw fail('InvalidCode', 'Неверный код', 401)
      await d.pds.adminUpdatePassword(user.did, password)
    }
    await d.users.setPasswordLogin(user.did, true)
    return c.json({ ok: true })
  })

  app.post('/me/email/confirm/request', async (c) => {
    const { token } = await requireUser(c)
    await d.pds.requestEmailConfirmation(token)
    return c.json({ ok: true })
  })

  app.post('/me/email/confirm', async (c) => {
    const { user, token } = await requireUser(c)
    const { code } = await body(c, ConfirmEmailBody)
    const info = await d.pds.getSession(token)
    if (!info.email) throw fail('NoEmail', 'У аккаунта нет email')
    try {
      await d.pds.confirmEmail(token, info.email, code)
    } catch (err) {
      if (err instanceof PdsError && err.status < 500) throw fail('InvalidCode', 'Код неверный или устарел')
      throw err
    }
    // 2FA по умолчанию: включаем сразу после подтверждения у тех, кто входит паролем
    if (user.password_login) await d.pds.setEmailAuthFactor(token, info.email, true)
    return c.json(await view(user, token))
  })

  // ── email-2FA (PDS) ───────────────────────────────────────────────────
  app.post('/me/2fa/email', async (c) => {
    const { user, token } = await requireUser(c)
    const { enabled, code } = await body(c, Email2faBody)
    const info = await d.pds.getSession(token)
    if (!info.email || !info.emailConfirmed) throw fail('EmailNotConfirmed', 'Сначала подтвердите email')
    if (enabled) {
      await d.pds.setEmailAuthFactor(token, info.email, true)
    } else if (!code) {
      // выключение снижает защиту: PDS требует код из письма
      await d.pds.requestEmailUpdate(token)
      return c.json({ codeSent: true })
    } else {
      try {
        await d.pds.setEmailAuthFactor(token, info.email, false, code)
      } catch (err) {
        if (err instanceof PdsError && err.status < 500) throw fail('InvalidCode', 'Код неверный или устарел')
        throw err
      }
    }
    return c.json(await view(user, token))
  })

  // ── TOTP ──────────────────────────────────────────────────────────────
  app.post('/me/2fa/totp/setup', async (c) => {
    const { user } = await requireUser(c)
    if ((await d.mfa.get(user.did)).totpEnabledAt) throw fail('AlreadyEnabled', 'Приложение-аутентификатор уже подключено', 409)
    const secret = newTotpSecret()
    await d.mfa.setPending(user.did, d.secrets.seal(secret))
    return c.json({ secret, otpauthUrl: otpauthUrl(secret, user.handle) })
  })

  app.post('/me/2fa/totp/enable', async (c) => {
    const { user, token } = await requireUser(c)
    const { code } = await body(c, CodeBody)
    const mfa = await d.mfa.get(user.did)
    if (!mfa.totpPendingEnc) throw fail('NoPendingSetup', 'Начните подключение заново')
    const secret = d.secrets.open(mfa.totpPendingEnc)
    const step = totpStep(secret, code)
    if (step === null) throw fail('InvalidCode', 'Неверный код из приложения')
    const backupCodes = newBackupCodes()
    await d.mfa.enable(user.did, d.secrets.seal(secret), backupCodes.map(hashBackupCode))
    await d.mfa.useTotpStep(user.did, step)
    // текущая сессия уже доказала владение: отмечаем её, чтобы не выкинуло сразу после включения
    const { refreshJwt } = z.object({ refreshJwt: z.string().max(4096).optional() }).parse(await c.req.json().catch(() => ({})))
    await d.mfa.markSessions(user.did, [tokenHash(token), ...(refreshJwt ? [tokenHash(refreshJwt)] : [])], MFA_SESSION_TTL)
    return c.json({ backupCodes, security: await view(user, token) })
  })

  app.post('/me/2fa/totp/disable', async (c) => {
    const { user, token } = await requireUser(c)
    const { code } = await body(c, CodeBody)
    if (!(await checkSecondFactor(user.did, code))) throw fail('InvalidCode', 'Неверный код', 401)
    await d.mfa.disable(user.did)
    return c.json(await view(user, token))
  })

  app.post('/me/2fa/backup-codes', async (c) => {
    const { user } = await requireUser(c)
    const { code } = await body(c, CodeBody)
    if (!(await checkSecondFactor(user.did, code))) throw fail('InvalidCode', 'Неверный код', 401)
    const backupCodes = newBackupCodes()
    await d.mfa.setBackupCodes(user.did, backupCodes.map(hashBackupCode))
    return c.json({ backupCodes })
  })
}
