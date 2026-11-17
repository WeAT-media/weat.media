/** Минимальный XRPC-клиент нашего PDS (@atproto/pds) */

export interface PdsSession {
  did: string
  handle: string
  accessJwt: string
  refreshJwt: string
}

export class PdsError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

export interface PdsClient {
  createAccount(a: { handle: string; email: string; password: string }): Promise<PdsSession>
  /** authFactorToken — код из письма, если у аккаунта включена email-2FA */
  createSession(identifier: string, password: string, authFactorToken?: string): Promise<PdsSession>
  getSession(accessJwt: string): Promise<PdsAccountInfo>
  refreshSession(refreshJwt: string): Promise<PdsSession>
  /** отзыв сессии в PDS: refresh-токен перестаёт обновляться */
  deleteSession(refreshJwt: string): Promise<void>
  /** app password для входа через привязанный аккаунт; требует полную (не app-pass) сессию */
  createAppPassword(accessJwt: string, name: string): Promise<{ password: string }>
  revokeAppPassword(accessJwt: string, name: string): Promise<void>
  /** admin: смена handle, включая зарезервированные имена */
  adminUpdateHandle(did: string, handle: string): Promise<void>
  /** admin: смена основного пароля локального аккаунта после подтверждённого AppView второго фактора */
  adminUpdatePassword(did: string, password: string): Promise<void>
  requestEmailConfirmation(accessJwt: string): Promise<void>
  confirmEmail(accessJwt: string, email: string, token: string): Promise<void>
  /** включение email-2FA: при подтверждённом email срабатывает сразу; выключение — по коду из письма */
  setEmailAuthFactor(accessJwt: string, email: string, enabled: boolean, token?: string): Promise<void>
  requestEmailUpdate(accessJwt: string): Promise<{ tokenRequired: boolean }>
  /** запись в репозиторий пользователя его же сессией (validate: false — наш лексикон PDS не знает) */
  createRecord(accessJwt: string, repo: string, collection: string, record: Record<string, unknown>): Promise<{ uri: string; cid: string }>
  deleteRecord(accessJwt: string, repo: string, collection: string, rkey: string): Promise<void>
  putRecord(accessJwt: string, repo: string, collection: string, rkey: string, record: Record<string, unknown>): Promise<{ uri: string; cid: string }>
  /** файл в репозиторий (аватар): ссылка на blob для записи */
  uploadBlob(accessJwt: string, bytes: Uint8Array, mimeType: string): Promise<{ blob: Record<string, unknown> }>
  /** публичное чтение репозитория; undefined — записи нет */
  getRecord(repo: string, collection: string, rkey: string): Promise<Record<string, unknown> | undefined>
  /** все репозитории этого PDS (публично) */
  listRepos(limit: number, cursor?: string): Promise<{ repos: { did: string; active?: boolean }[]; cursor?: string }>
  /** handle репозитория (публично) */
  describeRepo(repo: string): Promise<{ handle: string; did: string }>
  listRecords(repo: string, collection: string, limit: number, cursor?: string): Promise<{ records: { uri: string; cid: string; value: Record<string, unknown> }[]; cursor?: string }>
  /** смена handle сессией пользователя (PDS обновляет DID-документ) */
  updateHandle(accessJwt: string, handle: string): Promise<void>
  requestPasswordReset(email: string): Promise<void>
  resetPassword(token: string, password: string): Promise<void>
}

export interface PdsAccountInfo {
  did: string
  handle: string
  email?: string
  emailConfirmed?: boolean
  emailAuthFactor?: boolean
}

export function createPdsClient(baseUrl: string, adminPassword: string): PdsClient {
  const adminAuth = `Basic ${Buffer.from(`admin:${adminPassword}`).toString('base64')}`

  async function xrpc<T>(method: 'GET' | 'POST', nsid: string, opts: { auth?: string; body?: unknown } = {}): Promise<T> {
    const res = await fetch(new URL(`/xrpc/${nsid}`, baseUrl), {
      method,
      headers: {
        ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(opts.auth ? { authorization: opts.auth } : {}),
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    })
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
    if (!res.ok) {
      throw new PdsError(res.status, String(data.error ?? 'PdsError'), String(data.message ?? res.statusText))
    }
    return data as T
  }

  return {
    async createAccount({ handle, email, password }) {
      // PDS запущен с PDS_INVITE_REQUIRED=true: аккаунт можно создать только через нас
      const { code } = await xrpc<{ code: string }>('POST', 'com.atproto.server.createInviteCode', {
        auth: adminAuth,
        body: { useCount: 1 },
      })
      try {
        return await xrpc<PdsSession>('POST', 'com.atproto.server.createAccount', {
          body: { handle, email, password, inviteCode: code },
        })
      } catch (err) {
        // PDS 0.4 отдаёт занятость как InvalidRequest с текстом — приводим к стабильным кодам
        if (err instanceof PdsError && /^Handle already taken/i.test(err.message)) {
          throw new PdsError(409, 'HandleTaken', 'Этот username уже занят')
        }
        if (err instanceof PdsError && /^Email already taken/i.test(err.message)) {
          throw new PdsError(409, 'EmailTaken', 'Аккаунт с этим email уже есть — войдите')
        }
        if (err instanceof PdsError && err.code === 'HandleNotAvailable') {
          throw new PdsError(409, 'HandleNotAvailable', 'Этот username недоступен')
        }
        throw err
      }
    },
    async updateHandle(accessJwt, handle) {
      try {
        await xrpc<unknown>('POST', 'com.atproto.identity.updateHandle', { auth: `Bearer ${accessJwt}`, body: { handle } })
      } catch (err) {
        if (err instanceof PdsError && /already taken/i.test(err.message)) throw new PdsError(409, 'HandleTaken', 'Этот username уже занят')
        throw err
      }
    },
    createSession(identifier, password, authFactorToken) {
      return xrpc<PdsSession>('POST', 'com.atproto.server.createSession', {
        body: { identifier, password, ...(authFactorToken ? { authFactorToken } : {}) },
      })
    },
    getSession(accessJwt) {
      return xrpc('GET', 'com.atproto.server.getSession', { auth: `Bearer ${accessJwt}` })
    },
    async uploadBlob(accessJwt, bytes, mimeType) {
      const res = await fetch(new URL('/xrpc/com.atproto.repo.uploadBlob', baseUrl), {
        method: 'POST',
        headers: { authorization: `Bearer ${accessJwt}`, 'content-type': mimeType },
        body: new Blob([new Uint8Array(bytes)], { type: mimeType }),
      })
      const data = (await res.json().catch(() => ({}))) as { blob?: Record<string, unknown>; error?: string; message?: string }
      if (!res.ok || !data.blob) throw new PdsError(res.status, String(data.error ?? 'PdsError'), String(data.message ?? res.statusText))
      return { blob: data.blob }
    },
    async deleteSession(refreshJwt) {
      await xrpc<unknown>('POST', 'com.atproto.server.deleteSession', { auth: `Bearer ${refreshJwt}` })
    },
    refreshSession(refreshJwt) {
      return xrpc<PdsSession>('POST', 'com.atproto.server.refreshSession', { auth: `Bearer ${refreshJwt}` })
    },
    createAppPassword(accessJwt, name) {
      return xrpc('POST', 'com.atproto.server.createAppPassword', { auth: `Bearer ${accessJwt}`, body: { name } })
    },
    async requestEmailConfirmation(accessJwt) {
      await xrpc('POST', 'com.atproto.server.requestEmailConfirmation', { auth: `Bearer ${accessJwt}` })
    },
    async confirmEmail(accessJwt, email, token) {
      await xrpc('POST', 'com.atproto.server.confirmEmail', { auth: `Bearer ${accessJwt}`, body: { email, token } })
    },
    async setEmailAuthFactor(accessJwt, email, enabled, token) {
      await xrpc('POST', 'com.atproto.server.updateEmail', {
        auth: `Bearer ${accessJwt}`,
        body: { email, emailAuthFactor: enabled, ...(token ? { token } : {}) },
      })
    },
    requestEmailUpdate(accessJwt) {
      return xrpc('POST', 'com.atproto.server.requestEmailUpdate', { auth: `Bearer ${accessJwt}` })
    },
    createRecord(accessJwt, repo, collection, record) {
      return xrpc('POST', 'com.atproto.repo.createRecord', { auth: `Bearer ${accessJwt}`, body: { repo, collection, record, validate: false } })
    },
    async deleteRecord(accessJwt, repo, collection, rkey) {
      await xrpc('POST', 'com.atproto.repo.deleteRecord', { auth: `Bearer ${accessJwt}`, body: { repo, collection, rkey } })
    },
    putRecord(accessJwt, repo, collection, rkey, record) {
      return xrpc('POST', 'com.atproto.repo.putRecord', { auth: `Bearer ${accessJwt}`, body: { repo, collection, rkey, record, validate: false } })
    },
    async getRecord(repo, collection, rkey) {
      try {
        const r = await xrpc<{ value: Record<string, unknown> }>('GET', `com.atproto.repo.getRecord?${new URLSearchParams({ repo, collection, rkey })}`)
        return r.value
      } catch (err) {
        if (err instanceof PdsError && (err.status === 404 || err.code === 'RecordNotFound' || err.status === 400)) return undefined
        throw err
      }
    },
    listRepos(limit, cursor) {
      return xrpc('GET', `com.atproto.sync.listRepos?${new URLSearchParams({ limit: String(limit), ...(cursor ? { cursor } : {}) })}`)
    },
    describeRepo(repo) {
      return xrpc('GET', `com.atproto.repo.describeRepo?${new URLSearchParams({ repo })}`)
    },
    listRecords(repo, collection, limit, cursor) {
      const q = new URLSearchParams({ repo, collection, limit: String(limit), ...(cursor ? { cursor } : {}) })
      return xrpc('GET', `com.atproto.repo.listRecords?${q}`)
    },
    async requestPasswordReset(email) {
      await xrpc('POST', 'com.atproto.server.requestPasswordReset', { body: { email } })
    },
    async resetPassword(token, password) {
      await xrpc('POST', 'com.atproto.server.resetPassword', { body: { token, password } })
    },
    async adminUpdateHandle(did, handle) {
      await xrpc('POST', 'com.atproto.admin.updateAccountHandle', { auth: adminAuth, body: { did, handle } })
    },
    async adminUpdatePassword(did, password) {
      await xrpc('POST', 'com.atproto.admin.updateAccountPassword', { auth: adminAuth, body: { did, password } })
    },
    async revokeAppPassword(accessJwt, name) {
      await xrpc('POST', 'com.atproto.server.revokeAppPassword', { auth: `Bearer ${accessJwt}`, body: { name } })
    },
  }
}
