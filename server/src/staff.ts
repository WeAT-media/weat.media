import { createRemoteJWKSet, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from 'jose'
import type { Sql } from './db.js'

/**
 * Сотрудники входят через Zitadel: AppView проверяет JWT по JWKS сервиса входа
 * и берёт роли проекта weat.media из токена. Общий ADMIN_TOKEN остаётся только
 * аварийным ключом для автоматизации (break-glass) — у людей его нет.
 */

export const STAFF_ROLES = ['admin', 'support', 'moderator'] as const
export type StaffRole = (typeof STAFF_ROLES)[number]

export interface Staff {
  /** id пользователя в Zitadel */
  sub: string
  name: string | null
  roles: Set<StaffRole>
}

export interface StaffVerifier {
  /** null — токен не от нашего Zitadel или недействителен */
  verify(token: string): Promise<Staff | null>
}

/** jwksUrl — внутренний адрес Zitadel в docker-сети; jwks — ключи напрямую (тесты) */
export function createStaffVerifier(o: { issuer: string; projectId: string; jwksUrl?: string; jwks?: JWTVerifyGetKey }): StaffVerifier {
  const issuer = o.issuer.replace(/\/$/, '')
  const jwks = o.jwks ?? createRemoteJWKSet(new URL(o.jwksUrl ?? `${issuer}/oauth/v2/keys`), { cooldownDuration: 30_000 })
  return {
    async verify(token) {
      // JWT — три сегмента; остальное (PDS-токены, PAT) даже не пытаемся проверять
      if (token.split('.').length !== 3) return null
      let payload: JWTPayload
      try {
        ;({ payload } = await jwtVerify(token, jwks, { issuer, audience: o.projectId, algorithms: ['RS256', 'ES256', 'EdDSA'] }))
      } catch {
        return null
      }
      return { sub: payload.sub!, name: typeof payload.name === 'string' ? payload.name : null, roles: rolesOf(payload, o.projectId) }
    },
  }
}

/** Zitadel кладёт роли в urn:zitadel:iam:org:project:<id>:roles = { role: { orgId: domain } } */
export function rolesOf(payload: JWTPayload, projectId: string): Set<StaffRole> {
  const claim = payload[`urn:zitadel:iam:org:project:${projectId}:roles`] as Record<string, unknown> | undefined
  const out = new Set<StaffRole>()
  for (const r of Object.keys(claim ?? {})) if ((STAFF_ROLES as readonly string[]).includes(r)) out.add(r as StaffRole)
  return out
}

export interface AuditEntry {
  actor: string
  actorName: string | null
  action: string
  target: string | null
  details: Record<string, unknown> | null
  at: string
}

export interface AuditRepo {
  log(e: Omit<AuditEntry, 'at'>): Promise<void>
  recent(limit: number): Promise<AuditEntry[]>
}

export function auditRepo(sql: Sql): AuditRepo {
  return {
    async log(e) {
      await sql`
        INSERT INTO admin_audit (actor, actor_name, action, target, details)
        VALUES (${e.actor}, ${e.actorName}, ${e.action}, ${e.target}, ${e.details ? sql.json(e.details as never) : null})`
    },
    async recent(limit) {
      const rows = await sql<{ actor: string; actor_name: string | null; action: string; target: string | null; details: Record<string, unknown> | null; at: Date }[]>`
        SELECT actor, actor_name, action, target, details, at FROM admin_audit ORDER BY at DESC LIMIT ${limit}`
      return rows.map((r) => ({ actor: r.actor, actorName: r.actor_name, action: r.action, target: r.target, details: r.details, at: r.at.toISOString() }))
    },
  }
}
