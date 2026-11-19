import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Hono } from 'hono'
import { mountShareRoutes } from '../src/share.ts'

test('profile-record refuses a private PDS endpoint from the DID document', async () => {
  const calls: string[] = []
  const app = new Hono()
  mountShareRoutes(app, {
    siteUrl: 'https://weat.test',
    plcUrl: 'https://plc.test',
    fetcher: async (input) => {
      const url = String(input)
      calls.push(url)
      if (url === 'https://plc.test/did:plc:aaaaaaaaaaaaaaaaaaaaaaaa') {
        return Response.json({
          id: 'did:plc:aaaaaaaaaaaaaaaaaaaaaaaa',
          service: [{ id: '#atproto_pds', type: 'AtprotoPersonalDataServer', serviceEndpoint: 'https://127.0.0.1:8443' }],
        })
      }
      throw new Error(`private request rejected: ${url}`)
    },
  })
  const res = await app.request('/profile-record/did:plc:aaaaaaaaaaaaaaaaaaaaaaaa')
  assert.equal(res.status, 200)
  assert.deepEqual(await res.json(), { displayName: null, description: null })
  assert.equal(calls.length, 2)
  assert.match(calls[1]!, /^https:\/\/127\.0\.0\.1:8443\/xrpc\/com\.atproto\.repo\.getRecord\?/, 'запрос PDS идёт через safe fetcher и отклоняется им')
})
