import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import test from 'node:test'
import { Hono } from 'hono'
import { mountPdsGate } from '../src/pdsGate.ts'
import type { MfaRepo, UserRepo } from '../src/db.ts'
import type { PdsClient } from '../src/pds.ts'

const jwt = `h.${Buffer.from(JSON.stringify({ sub: 'did:plc:alina', scope: 'com.atproto.access' })).toString('base64url')}.s`

function gate(rawRequest?: typeof import('undici').request) {
  const app = new Hono()
  const revoked: string[] = []
  mountPdsGate(app, {
    pdsUrl: 'http://pds.internal:2583',
    pdsHost: 'pds.weat.media',
    pds: {
      createAppPassword: async (token: string, name: string) => {
        assert.equal(token, jwt)
        return { password: `pw-for-${name}` }
      },
      revokeAppPassword: async (_token: string, name: string) => void revoked.push(name),
    } as unknown as PdsClient,
    mfa: { get: async () => ({ totpEnabledAt: null }) } as unknown as MfaRepo,
    users: { findByDid: async () => ({ did: 'did:plc:alina' }) } as unknown as UserRepo,
    rawRequest,
  })
  return { app, revoked }
}

const oauthBody = {
  client_id: 'https://atstore.fyi/api/auth/atproto/metadata.json',
  request_uri: 'urn:ietf:params:oauth:request_uri:req-123',
}

test('AT OAuth bridge: social session returns to authorize, forwards cookies and revokes temporary app password', async () => {
  const calls: string[] = []
  const rawRequest = (async (url: URL, init: { headers: Record<string, string>; body: string }) => {
    const u = String(url)
    calls.push(u)
    assert.equal(u, 'http://pds.internal:2583/@atproto/oauth-provider/~api/sign-in')
    assert.equal(init.headers['x-csrf-token'], 'csrf123')
    assert.equal(init.headers['sec-fetch-mode'], 'same-origin')
    const body = JSON.parse(init.body) as { locale: string; identifier: string; password: string; remember: boolean }
    assert.equal(body.locale, 'ru')
    assert.equal(body.remember, true)
    assert.equal(body.identifier, 'did:plc:alina')
    assert.match(body.password, /^pw-for-oauth-bridge-/)
    return { statusCode: 200, headers: { 'set-cookie': 'oauth-session=ok; Path=/; HttpOnly; Secure; SameSite=Lax' }, body: { json: async () => ({ account: { sub: body.identifier } }) } }
  }) as typeof import('undici').request
  const { app, revoked } = gate(rawRequest)
  const realFetch = globalThis.fetch
  globalThis.fetch = (async (url: URL | string) => {
    const u = String(url)
    calls.push(u)
    assert.ok(u.startsWith('https://pds.weat.media/oauth/authorize'))
    return new Response('<html>sign in</html>', { status: 200, headers: { 'set-cookie': 'csrf-token=csrf123; Path=/; HttpOnly; Secure; SameSite=Lax' } })
  }) as typeof fetch
  try {
    const prepared = await app.request('/pds/oauth/prepare', {
      method: 'POST',
      headers: { authorization: `Bearer ${jwt}`, 'content-type': 'application/json' },
      body: JSON.stringify(oauthBody),
    })
    assert.equal(prepared.status, 200)
    const { url } = await prepared.json() as { url: string }
    const code = new URL(url).searchParams.get('code')!
    assert.equal(new URL(url).origin, 'https://pds.weat.media')
    const continued = await app.request(`/pds/oauth-continue?code=${encodeURIComponent(code)}`)
    assert.equal(continued.status, 302)
    assert.equal(continued.headers.get('location'), 'https://pds.weat.media/oauth/authorize?client_id=https%3A%2F%2Fatstore.fyi%2Fapi%2Fauth%2Fatproto%2Fmetadata.json&request_uri=urn%3Aietf%3Aparams%3Aoauth%3Arequest_uri%3Areq-123')
    assert.deepEqual(continued.headers.getSetCookie().map((v) => v.split('=', 1)[0]), ['csrf-token', 'oauth-session'])
    assert.equal(revoked.length, 1)
    assert.match(revoked[0]!, /^oauth-bridge-/)
    assert.equal((await app.request(`/pds/oauth-continue?code=${encodeURIComponent(code)}`)).status, 400, 'код одноразовый')
    assert.equal(calls.filter((u) => u.includes('/~api/sign-in')).length, 1)
  } finally {
    globalThis.fetch = realFetch
  }
})

test('AT OAuth bridge: requires a session and accepts only an AT authorize request', async () => {
  const { app } = gate()
  assert.equal((await app.request('/pds/oauth/prepare', { method: 'POST', body: JSON.stringify(oauthBody) })).status, 401)
  const bad = await app.request('/pds/oauth/prepare', {
    method: 'POST',
    headers: { authorization: `Bearer ${jwt}`, 'content-type': 'application/json' },
    body: JSON.stringify({ ...oauthBody, client_id: 'https://evil.example/callback' }),
  })
  assert.equal(bad.status, 200, 'client_id — публичные метаданные AT-клиента, не redirect URI')
  const badRequest = await app.request('/pds/oauth/prepare', {
    method: 'POST',
    headers: { authorization: `Bearer ${jwt}`, 'content-type': 'application/json' },
    body: JSON.stringify({ ...oauthBody, request_uri: 'https://evil.example/request' }),
  })
  assert.equal(badRequest.status, 400)
})


test('AT OAuth bridge: real HTTP request preserves Sec-Fetch-Mode same-origin', async (t) => {
  let seenMode: string | undefined
  const server = createServer((req, res) => {
    seenMode = req.headers['sec-fetch-mode']
    res.writeHead(200, { 'content-type': 'application/json', 'set-cookie': 'oauth-session=ok; Path=/; HttpOnly' })
    res.end('{"account":{"sub":"did:plc:alina"}}')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(() => server.close())
  const address = server.address()
  assert.ok(address && typeof address === 'object')
  const app = new Hono()
  mountPdsGate(app, {
    pdsUrl: `http://127.0.0.1:${address.port}`,
    pdsHost: 'pds.weat.media',
    pds: {
      createAppPassword: async () => ({ password: 'temporary' }),
      revokeAppPassword: async () => {},
    } as unknown as PdsClient,
    mfa: { get: async () => ({ totpEnabledAt: null }) } as unknown as MfaRepo,
  })
  const realFetch = globalThis.fetch
  globalThis.fetch = (async () => new Response('', { status: 200, headers: { 'set-cookie': 'csrf-token=csrf123; Path=/' } })) as typeof fetch
  t.after(() => { globalThis.fetch = realFetch })
  const prepared = await app.request('/pds/oauth/prepare', {
    method: 'POST',
    headers: { authorization: `Bearer ${jwt}`, 'content-type': 'application/json' },
    body: JSON.stringify(oauthBody),
  })
  const { url } = await prepared.json() as { url: string }
  const response = await app.request(`/pds/oauth-continue?code=${encodeURIComponent(new URL(url).searchParams.get('code')!)}`)
  assert.equal(response.status, 302)
  assert.equal(seenMode, 'same-origin')
})
