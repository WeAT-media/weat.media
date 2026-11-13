import {
  NodeOAuthClient,
  buildAtprotoLoopbackClientMetadata,
  requestLocalLock,
  type NodeSavedSession,
  type NodeSavedState,
  type OAuthClientMetadataInput,
} from '@atproto/oauth-client-node'

/** Вход через внешний AT-аккаунт (bsky.social, свой PDS) по AT OAuth: нужен только подтверждённый DID */
export interface AtprotoAuth {
  /** URL страницы согласия на PDS пользователя */
  authorize(handle: string, appState: string): Promise<string>
  /** проверяет ответ PDS; токены сразу отзываются — данные чужого PDS нам не нужны */
  callback(params: URLSearchParams): Promise<{ did: string; handle: string | null; appState: string | null }>
  clientMetadata: OAuthClientMetadataInput
}

function memoryStore<T>(ttlMs: number) {
  const m = new Map<string, { v: T; exp: number }>()
  return {
    async set(k: string, v: T) {
      m.set(k, { v, exp: Date.now() + ttlMs })
    },
    async get(k: string) {
      const e = m.get(k)
      if (!e || e.exp < Date.now()) return undefined
      return e.v
    },
    async del(k: string) {
      m.delete(k)
    },
  }
}

export function createAtprotoAuth(opts: {
  publicUrl: string
  /** dev: loopback-клиент; redirect только на 127.0.0.1 */
  devPort?: number
  plcDirectoryUrl?: string
  handleResolver?: string
  allowHttp?: boolean
}): AtprotoAuth {
  const loopback = opts.publicUrl.startsWith('http://')
  const clientMetadata: OAuthClientMetadataInput = loopback
    ? buildAtprotoLoopbackClientMetadata({
        scope: 'atproto',
        redirect_uris: [`http://127.0.0.1:${opts.devPort ?? new URL(opts.publicUrl).port}/api/auth/atproto/callback`],
      })
    : {
        client_id: `${opts.publicUrl}/api/oauth/client-metadata.json`,
        client_name: 'Indie.media',
        client_uri: opts.publicUrl,
        redirect_uris: [`${opts.publicUrl}/api/auth/atproto/callback`],
        scope: 'atproto',
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        application_type: 'web',
        token_endpoint_auth_method: 'none',
        dpop_bound_access_tokens: true,
      }

  const client = new NodeOAuthClient({
    clientMetadata,
    stateStore: memoryStore<NodeSavedState>(10 * 60_000),
    sessionStore: memoryStore<NodeSavedSession>(5 * 60_000),
    plcDirectoryUrl: opts.plcDirectoryUrl,
    handleResolver: opts.handleResolver ?? 'https://bsky.social',
    allowHttp: opts.allowHttp,
    // один процесс AppView; при нескольких репликах нужен распределённый лок
    requestLock: requestLocalLock,
  })

  return {
    clientMetadata,
    async authorize(handle, appState) {
      return (await client.authorize(handle, { scope: 'atproto', state: appState })).toString()
    },
    async callback(params) {
      const { session, state } = await client.callback(params)
      const did = session.did
      const identity = await client.identityResolver.resolve(did).catch(() => null)
      await client.revoke(did).catch(() => {})
      const handle = identity && identity.handle !== 'handle.invalid' ? identity.handle : null
      return { did, handle, appState: state }
    },
  }
}
