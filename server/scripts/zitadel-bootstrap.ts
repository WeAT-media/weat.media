/**
 * Начальная настройка Zitadel для weat.media. Идемпотентно: можно запускать повторно.
 *   ZITADEL_URL=http://localhost:8080 ZITADEL_PAT=... SITE_URLS=http://localhost:3000 npx tsx scripts/zitadel-bootstrap.ts
 * PAT — сервисного аккаунта appview (deploy/auth, том bootstrap/appview.pat).
 * Создаёт проект, роли сотрудников, OIDC-приложение сайта (PKCE, без секрета),
 * обязательную 2FA в организации сотрудников и роль admin первому администратору.
 * В конце печатает переменные для server/.env.
 */

const ZITADEL_URL = process.env.ZITADEL_URL ?? 'http://localhost:8080'
const PAT = process.env.ZITADEL_PAT
if (!PAT) throw new Error('ZITADEL_PAT не задан')
const SITE_URLS = (process.env.SITE_URLS ?? 'http://localhost:3000').split(',').map((s) => s.trim().replace(/\/$/, ''))
const PROJECT = process.env.ZITADEL_PROJECT ?? 'weat.media'
const APP = 'weat.media web'

const ROLES = [
  { key: 'admin', displayName: 'Администратор' },
  { key: 'support', displayName: 'Поддержка' },
  { key: 'moderator', displayName: 'Модератор' },
]

async function api<T>(path: string, body?: unknown, method = 'POST'): Promise<T> {
  const res = await fetch(new URL(path, ZITADEL_URL), {
    method,
    headers: { authorization: `Bearer ${PAT}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const data = (await res.json().catch(() => ({}))) as T & { code?: number; message?: string }
  if (!res.ok) throw Object.assign(new Error(`${method} ${path}: ${res.status} ${data.message ?? ''}`), { status: res.status })
  return data
}

const ignore400 = (err: unknown) => {
  // «ничего не изменилось» Zitadel отдаёт как 400
  if ((err as { status?: number }).status !== 400) throw err
}

async function main() {
  // проект: роли попадают в токен (projectRoleAssertion)
  const found = await api<{ result?: { id: string }[] }>('/management/v1/projects/_search', {
    queries: [{ nameQuery: { name: PROJECT, method: 'TEXT_QUERY_METHOD_EQUALS' } }],
  })
  const projectId =
    found.result?.[0]?.id ??
    (await api<{ id: string }>('/management/v1/projects', { name: PROJECT, projectRoleAssertion: true })).id

  try {
    await api(`/management/v1/projects/${projectId}/roles/_bulk`, { roles: ROLES })
  } catch (err) {
    if ((err as { status?: number }).status !== 409) throw err
  }

  const redirectUris = SITE_URLS.map((u) => `${u}/auth/callback`)
  const postLogoutRedirectUris = SITE_URLS.map((u) => `${u}/`)
  const oidc = {
    redirectUris,
    postLogoutRedirectUris,
    responseTypes: ['OIDC_RESPONSE_TYPE_CODE'],
    grantTypes: ['OIDC_GRANT_TYPE_AUTHORIZATION_CODE', 'OIDC_GRANT_TYPE_REFRESH_TOKEN'],
    appType: 'OIDC_APP_TYPE_USER_AGENT',
    authMethodType: 'OIDC_AUTH_METHOD_TYPE_NONE',
    accessTokenType: 'OIDC_TOKEN_TYPE_JWT',
    accessTokenRoleAssertion: true,
    idTokenRoleAssertion: true,
    idTokenUserinfoAssertion: true,
    // http://localhost разрешён только в dev-режиме приложения
    devMode: SITE_URLS.some((u) => u.startsWith('http://')),
  }
  const apps = await api<{ result?: { id: string; name: string; oidcConfig?: { clientId: string } }[] }>(
    `/management/v1/projects/${projectId}/apps/_search`,
    {},
  )
  const existing = apps.result?.find((a) => a.name === APP)
  let clientId: string
  if (existing) {
    await api(`/management/v1/projects/${projectId}/apps/${existing.id}/oidc_config`, oidc, 'PUT').catch(ignore400)
    clientId = existing.oidcConfig!.clientId
  } else {
    clientId = (await api<{ clientId: string }>(`/management/v1/projects/${projectId}/apps/oidc`, { name: APP, ...oidc })).clientId
  }

  // организация первого экземпляра — сотрудники: второй фактор обязателен (passkey или приложение)
  const loginPolicy = {
    allowUsernamePassword: true,
    allowRegister: false,
    allowExternalIdp: false,
    forceMfa: true,
    forceMfaLocalOnly: false,
    passwordlessType: 'PASSWORDLESS_TYPE_ALLOWED',
    secondFactors: ['SECOND_FACTOR_TYPE_OTP', 'SECOND_FACTOR_TYPE_U2F'],
    multiFactors: ['MULTI_FACTOR_TYPE_U2F_WITH_VERIFICATION'],
  }
  const current = await api<{ policy?: { isDefault?: boolean } }>('/management/v1/policies/login', undefined, 'GET')
  // своя политика у организации уже есть (isDefault не true) — обновляем, иначе создаём
  if (current.policy && current.policy.isDefault !== true) await api('/management/v1/policies/login', loginPolicy, 'PUT').catch(ignore400)
  else await api('/management/v1/policies/login', loginPolicy)

  // первый администратор получает роль admin
  const adminUser = process.env.STAFF_ADMIN_USERNAME ?? 'zitadel-admin@'
  const users = await api<{ result?: { id: string }[] }>('/management/v1/users/_search', {
    queries: [{ userNameQuery: { userName: adminUser, method: 'TEXT_QUERY_METHOD_STARTS_WITH' } }],
  })
  // userName первого админа — zitadel-admin@<домен организации>
  const adminId = users.result?.[0]?.id
  if (!adminId) console.warn(`# пользователь ${adminUser} не найден — роль admin не выдана`)
  if (adminId) {
    await api(`/management/v1/users/${adminId}/grants`, { projectId, roleKeys: ['admin'] }).catch((err) => {
      if ((err as { status?: number }).status !== 409) throw err
    })
  }

  console.log(`# Zitadel готов: проект ${PROJECT} (${projectId}), роли ${ROLES.map((r) => r.key).join(', ')}`)
  console.log(`ZITADEL_ISSUER=${ZITADEL_URL}`)
  console.log(`ZITADEL_PROJECT_ID=${projectId}`)
  console.log(`ZITADEL_CLIENT_ID=${clientId}`)
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
