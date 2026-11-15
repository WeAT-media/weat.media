import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Hono } from 'hono'
import { homeContourProxy } from '../src/contour.ts'

const jwt = (aud: string) => `x.${Buffer.from(JSON.stringify({ aud, sub: 'did:plc:a' })).toString('base64url')}.y`

test('homeContourProxy: peer-contour token goes to the peer, own token stays, hop is not re-proxied', async () => {
  const calls: { url: string; hop: string | null; body: string }[] = []
  const realFetch = globalThis.fetch
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), hop: new Headers(init?.headers).get('x-indie-peer-hop'), body: init?.body ? new TextDecoder().decode(init.body as ArrayBuffer) : '' })
    return new Response(JSON.stringify({ from: 'peer' }), { status: 200, headers: { 'content-type': 'application/json' } })
  }) as typeof fetch
  try {
    const app = new Hono().basePath('/api')
    app.use('*', homeContourProxy({ ownPdsHost: 'pds-ru.weat.media', peer: { publicUrl: 'https://nl-1.weat.media', resolve: async () => null, profile: async () => null } }))
    app.get('/me/drafts', (c) => c.json({ from: 'local' }))
    app.post('/auth/refresh', (c) => c.json({ from: 'local' }))

    const own = await app.request('/api/me/drafts', { headers: { authorization: `Bearer ${jwt('did:web:pds-ru.weat.media')}` } })
    assert.deepEqual(await own.json(), { from: 'local' })

    const foreign = await app.request('/api/me/drafts?x=1', { headers: { authorization: `Bearer ${jwt('did:web:pds.weat.media')}` } })
    assert.deepEqual(await foreign.json(), { from: 'peer' })
    assert.equal(calls.at(-1)!.url, 'https://nl-1.weat.media/api/me/drafts?x=1')
    assert.equal(calls.at(-1)!.hop, '1')

    // refresh: токен в теле
    const refresh = await app.request('/api/auth/refresh', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ refreshJwt: jwt('did:web:pds.weat.media') }) })
    assert.deepEqual(await refresh.json(), { from: 'peer' })
    assert.match(calls.at(-1)!.body, /refreshJwt/)

    // уже пришло от соседа — обратно не шлём; Zitadel и PAT не трогаем
    const n = calls.length
    assert.deepEqual(await (await app.request('/api/me/drafts', { headers: { 'x-indie-peer-hop': '1', authorization: `Bearer ${jwt('did:web:pds.weat.media')}` } })).json(), { from: 'local' })
    assert.deepEqual(await (await app.request('/api/me/drafts', { headers: { authorization: 'Bearer wm_pat_abc' } })).json(), { from: 'local' })
    assert.equal(calls.length, n)
  } finally {
    globalThis.fetch = realFetch
  }
})
