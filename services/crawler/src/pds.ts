/** XRPC нашего PDS: аккаунты краулеров и публикация записей от их имени */

export class PdsError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

interface Session {
  did: string
  handle: string
  accessJwt: string
  refreshJwt: string
}

export function createPds(baseUrl: string, adminPassword: string) {
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
    if (!res.ok) throw new PdsError(res.status, String(data.error ?? 'PdsError'), String(data.message ?? res.statusText))
    return data as T
  }

  // сессии краулеров в памяти: createSession у PDS ограничен по частоте
  const sessions = new Map<string, Session>()

  async function session(handle: string, password: string, fresh = false): Promise<Session> {
    const cached = sessions.get(handle)
    if (cached && !fresh) return cached
    const s = await xrpc<Session>('POST', 'com.atproto.server.createSession', { body: { identifier: handle, password } })
    sessions.set(handle, s)
    return s
  }

  return {
    async createAccount(handle: string, email: string, password: string): Promise<Session> {
      const { code } = await xrpc<{ code: string }>('POST', 'com.atproto.server.createInviteCode', {
        auth: adminAuth,
        body: { useCount: 1 },
      })
      return xrpc<Session>('POST', 'com.atproto.server.createAccount', { body: { handle, email, password, inviteCode: code } })
    },

    /** запись в репозиторий краулера; при истёкшей сессии — одна повторная попытка */
    async createRecord(
      cred: { handle: string; password: string },
      collection: string,
      record: Record<string, unknown>,
    ): Promise<{ uri: string; cid: string }> {
      const run = async (fresh: boolean) => {
        const s = await session(cred.handle, cred.password, fresh)
        return xrpc<{ uri: string; cid: string }>('POST', 'com.atproto.repo.createRecord', {
          auth: `Bearer ${s.accessJwt}`,
          // validate: false — PDS не знает наш лексикон media.weat.*; формат проверяем сами
          body: { repo: s.did, collection, record, validate: false },
        })
      }
      try {
        return await run(false)
      } catch (err) {
        if (err instanceof PdsError && (err.status === 401 || err.code === 'ExpiredToken' || err.code === 'InvalidToken')) {
          return run(true)
        }
        throw err
      }
    },

    async putProfile(cred: { handle: string; password: string }, displayName: string, description: string) {
      const s = await session(cred.handle, cred.password)
      await xrpc('POST', 'com.atproto.repo.putRecord', {
        auth: `Bearer ${s.accessJwt}`,
        body: { repo: s.did, collection: 'app.bsky.actor.profile', rkey: 'self', record: { $type: 'app.bsky.actor.profile', displayName, description } },
      })
    },
  }
}

export type Pds = ReturnType<typeof createPds>
