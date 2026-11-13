import postgres from 'postgres'
import type { Provider } from './providers.js'

export type Sql = postgres.Sql

export type Tier = 'free' | 'premium'

export interface UserRow {
  did: string
  handle: string
  display_name: string | null
  signup_country: string
  signup_utm?: Record<string, string> | null
  tier: Tier
  premium_since: Date | null
  created_at: Date
  /** пользователь знает пароль PDS (регистрация по email) */
  password_login: boolean
}

export function createDb(url: string): Sql {
  return postgres(url, { max: 10, onnotice: () => {} })
}

export interface UserRepo {
  insert(u: { did: string; handle: string; displayName?: string; signupCountry: string; passwordLogin?: boolean; signupUtm?: Record<string, string>; consentVersion?: string }): Promise<UserRow>
  findByDid(did: string): Promise<UserRow | undefined>
  findByHandleOrDid(id: string): Promise<UserRow | undefined>
  setTier(did: string, tier: Tier): Promise<UserRow | undefined>
  setPasswordLogin(did: string, value: boolean): Promise<void>
  setDisplayName(did: string, name: string | null): Promise<void>
}

export interface Identity {
  provider: Provider
  providerUserId: string
  did: string
  pdsPasswordEnc: string
  display: string | null
  /** null — в pdsPasswordEnc основной пароль PDS (аккаунт создан через этого провайдера) */
  appPasswordName: string | null
  createdAt: Date
}

export interface IdentityRepo {
  find(provider: Provider, providerUserId: string): Promise<Identity | undefined>
  listByDid(did: string): Promise<Identity[]>
  insert(i: Omit<Identity, 'createdAt'>): Promise<void>
  remove(did: string, provider: Provider): Promise<Identity | undefined>
  /** основной пароль PDS -> app password (после смены/сброса пароля) */
  updateSecret(did: string, provider: Provider, pdsPasswordEnc: string, appPasswordName: string): Promise<void>
}

interface IdentityRow {
  provider: Provider
  provider_user_id: string
  did: string
  pds_password_enc: string
  display: string | null
  app_password_name: string | null
  created_at: Date
}

const toIdentity = (r: IdentityRow): Identity => ({
  provider: r.provider,
  providerUserId: r.provider_user_id,
  did: r.did,
  pdsPasswordEnc: r.pds_password_enc,
  display: r.display,
  appPasswordName: r.app_password_name,
  createdAt: r.created_at,
})

export function identityRepo(sql: Sql): IdentityRepo {
  return {
    async find(provider, providerUserId) {
      const [row] = await sql<IdentityRow[]>`
        SELECT * FROM identities WHERE provider = ${provider} AND provider_user_id = ${providerUserId}`
      return row && toIdentity(row)
    },
    async listByDid(did) {
      const rows = await sql<IdentityRow[]>`SELECT * FROM identities WHERE did = ${did} ORDER BY created_at`
      return rows.map(toIdentity)
    },
    async insert(i) {
      await sql`
        INSERT INTO identities (provider, provider_user_id, did, pds_password_enc, display, app_password_name)
        VALUES (${i.provider}, ${i.providerUserId}, ${i.did}, ${i.pdsPasswordEnc}, ${i.display}, ${i.appPasswordName})`
    },
    async updateSecret(did, provider, enc, name) {
      await sql`
        UPDATE identities SET pds_password_enc = ${enc}, app_password_name = ${name}
        WHERE did = ${did} AND provider = ${provider}`
    },
    async remove(did, provider) {
      const [row] = await sql<IdentityRow[]>`
        DELETE FROM identities WHERE did = ${did} AND provider = ${provider} RETURNING *`
      return row && toIdentity(row)
    },
  }
}

export function userRepo(sql: Sql): UserRepo {
  return {
    async insert(u) {
      const [row] = await sql<UserRow[]>`
        INSERT INTO users (did, handle, display_name, signup_country, password_login, signup_utm,
                           pd_consent_at, pd_consent_version, terms_version)
        VALUES (${u.did}, ${u.handle}, ${u.displayName ?? null}, ${u.signupCountry}, ${u.passwordLogin ?? true},
                ${u.signupUtm ? sql.json(u.signupUtm) : null},
                ${u.consentVersion ? new Date() : null}, ${u.consentVersion ?? null}, ${u.consentVersion ?? null})
        ON CONFLICT (did) DO UPDATE SET handle = EXCLUDED.handle
        RETURNING *`
      return row!
    },
    async findByDid(did) {
      const [row] = await sql<UserRow[]>`SELECT * FROM users WHERE did = ${did}`
      return row
    },
    async findByHandleOrDid(id) {
      const [row] = await sql<UserRow[]>`
        SELECT * FROM users WHERE did = ${id} OR lower(handle) = lower(${id}) LIMIT 1`
      return row
    },
    async setPasswordLogin(did, value) {
      await sql`UPDATE users SET password_login = ${value} WHERE did = ${did}`
    },
    async setDisplayName(did, name) {
      await sql`UPDATE users SET display_name = ${name} WHERE did = ${did}`
    },
    async setTier(did, tier) {
      const [row] = await sql<UserRow[]>`
        UPDATE users
        SET tier = ${tier},
            premium_since = CASE WHEN ${tier} = 'premium' THEN COALESCE(premium_since, now()) ELSE NULL END
        WHERE did = ${did}
        RETURNING *`
      return row
    },
  }
}

export interface MfaRow {
  totpSecretEnc: string | null
  totpPendingEnc: string | null
  totpEnabledAt: Date | null
  backupCodeHashes: string[]
}

export interface MfaRepo {
  get(did: string): Promise<MfaRow>
  setPending(did: string, enc: string): Promise<void>
  enable(did: string, secretEnc: string, backupHashes: string[]): Promise<void>
  disable(did: string): Promise<void>
  /** атомарно гасит резервный код; false — кода нет */
  consumeBackupCode(did: string, hash: string): Promise<boolean>
  setBackupCodes(did: string, hashes: string[]): Promise<void>
  /** код TOTP одноразовый: шаг принимается, только если он новее последнего использованного */
  useTotpStep(did: string, step: number): Promise<boolean>
  /** дата окончания блокировки после серии неверных кодов */
  lockedUntil(did: string): Promise<Date | null>
  recordFailure(did: string, max: number, windowMs: number, lockMs: number): Promise<void>
  resetFailures(did: string): Promise<void>
  markSessions(did: string, tokenHashes: string[], ttlMs: number): Promise<void>
  isSessionMarked(tokenHash: string): Promise<boolean>
  /** false — mfaToken уже использован */
  consumeMfaToken(tokenHash: string, expiresAt: Date): Promise<boolean>
}

export function mfaRepo(sql: Sql): MfaRepo {
  const empty: MfaRow = { totpSecretEnc: null, totpPendingEnc: null, totpEnabledAt: null, backupCodeHashes: [] }
  return {
    async get(did) {
      const [r] = await sql<{ totp_secret_enc: string | null; totp_pending_enc: string | null; totp_enabled_at: Date | null; backup_code_hashes: string[] }[]>`
        SELECT totp_secret_enc, totp_pending_enc, totp_enabled_at, backup_code_hashes FROM user_mfa WHERE did = ${did}`
      if (!r) return empty
      return {
        totpSecretEnc: r.totp_secret_enc,
        totpPendingEnc: r.totp_pending_enc,
        totpEnabledAt: r.totp_enabled_at,
        backupCodeHashes: r.backup_code_hashes,
      }
    },
    async setPending(did, enc) {
      await sql`
        INSERT INTO user_mfa (did, totp_pending_enc) VALUES (${did}, ${enc})
        ON CONFLICT (did) DO UPDATE SET totp_pending_enc = EXCLUDED.totp_pending_enc, updated_at = now()`
    },
    async enable(did, secretEnc, hashes) {
      await sql`
        UPDATE user_mfa SET totp_secret_enc = ${secretEnc}, totp_pending_enc = NULL, totp_enabled_at = now(),
          backup_code_hashes = ${hashes}, updated_at = now()
        WHERE did = ${did}`
    },
    async disable(did) {
      await sql`
        UPDATE user_mfa SET totp_secret_enc = NULL, totp_pending_enc = NULL, totp_enabled_at = NULL,
          backup_code_hashes = '{}', updated_at = now()
        WHERE did = ${did}`
    },
    async consumeBackupCode(did, hash) {
      const rows = await sql`
        UPDATE user_mfa SET backup_code_hashes = array_remove(backup_code_hashes, ${hash}), updated_at = now()
        WHERE did = ${did} AND ${hash} = ANY(backup_code_hashes)
        RETURNING did`
      return rows.length > 0
    },
    async setBackupCodes(did, hashes) {
      await sql`UPDATE user_mfa SET backup_code_hashes = ${hashes}, updated_at = now() WHERE did = ${did}`
    },
    async useTotpStep(did, step) {
      const rows = await sql`
        UPDATE user_mfa SET totp_last_step = ${step}
        WHERE did = ${did} AND (totp_last_step IS NULL OR totp_last_step < ${step}) RETURNING 1`
      return rows.length > 0
    },
    async lockedUntil(did) {
      const [r] = await sql<{ locked_until: Date | null }[]>`SELECT locked_until FROM user_mfa WHERE did = ${did} AND locked_until > now()`
      return r?.locked_until ?? null
    },
    async recordFailure(did, max, windowMs, lockMs) {
      // окно счётчика сбрасывается само; при max неудачах в окне — блокировка
      await sql`
        UPDATE user_mfa SET
          failures = CASE WHEN failures_since IS NULL OR failures_since < now() - ${windowMs} * interval '1 millisecond' THEN 1 ELSE failures + 1 END,
          failures_since = CASE WHEN failures_since IS NULL OR failures_since < now() - ${windowMs} * interval '1 millisecond' THEN now() ELSE failures_since END
        WHERE did = ${did}`
      await sql`
        UPDATE user_mfa SET locked_until = now() + ${lockMs} * interval '1 millisecond', failures = 0, failures_since = NULL
        WHERE did = ${did} AND failures >= ${max}`
    },
    async resetFailures(did) {
      await sql`UPDATE user_mfa SET failures = 0, failures_since = NULL, locked_until = NULL WHERE did = ${did}`
    },
    async markSessions(did, hashes, ttlMs) {
      if (!hashes.length) return
      const exp = new Date(Date.now() + ttlMs)
      await sql`
        INSERT INTO mfa_sessions ${sql(hashes.map((h) => ({ token_hash: h, did, expires_at: exp })))}
        ON CONFLICT (token_hash) DO NOTHING`
      await sql`DELETE FROM mfa_sessions WHERE expires_at < now()`
    },
    async isSessionMarked(hash) {
      const [r] = await sql`SELECT 1 FROM mfa_sessions WHERE token_hash = ${hash} AND expires_at > now()`
      return !!r
    },
    async consumeMfaToken(hash, expiresAt) {
      await sql`DELETE FROM mfa_used_tokens WHERE expires_at < now()`
      const rows = await sql`INSERT INTO mfa_used_tokens (token_hash, expires_at) VALUES (${hash}, ${expiresAt}) ON CONFLICT DO NOTHING RETURNING 1`
      return rows.length > 0
    },
  }
}
