import { createRemoteJWKSet, jwtVerify } from 'jose'

/**
 * Админ-API краулера принимает сотрудника Zitadel с ролью admin (как AppView, см. server/src/staff.ts).
 * ADMIN_TOKEN остаётся аварийным ключом для автоматизации.
 */
export function createStaffCheck(o: { issuer: string; projectId: string; jwksUrl?: string }) {
  const issuer = o.issuer.replace(/\/$/, '')
  const jwks = createRemoteJWKSet(new URL(o.jwksUrl ?? `${issuer}/oauth/v2/keys`), { cooldownDuration: 30_000 })
  const claim = `urn:zitadel:iam:org:project:${o.projectId}:roles`
  return async (token: string): Promise<boolean> => {
    if (token.split('.').length !== 3) return false
    try {
      const { payload } = await jwtVerify(token, jwks, { issuer, audience: o.projectId, algorithms: ['RS256', 'ES256', 'EdDSA'] })
      const roles = payload[claim] as Record<string, unknown> | undefined
      return !!roles && 'admin' in roles
    } catch {
      return false
    }
  }
}
