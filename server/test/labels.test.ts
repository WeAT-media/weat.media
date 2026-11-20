import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Hono } from 'hono'
import { mountLabelRoutes } from '../src/labels.ts'
import { PdsError } from '../src/pds.ts'

test('labelers: RU contour hides nsfw/politics publicly, staff list is complete; no staff — refused', async () => {
  const realFetch = globalThis.fetch
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ labelers: ['general', 'nsfw', 'politics', 'spam'].map((id) => ({ id, labels: [] })) }), { status: 200, headers: { 'content-type': 'application/json' } })) as typeof fetch
  try {
    const app = new Hono()
    app.onError((e, c) => c.json({ error: (e as PdsError).error }, ((e as PdsError).status ?? 500) as 401))
    mountLabelRoutes(app, { labelerUrl: 'http://labeler.test', hidden: ['nsfw', 'politics'] }, {
      requireStaff: async (c) => {
        if (c.req.header('authorization') !== 'Bearer mod') throw new PdsError(401, 'AuthenticationRequired', 'нужен вход')
        return 'break-glass'
      },
      audit: async () => {},
    })
    const ids = async (path: string, headers: Record<string, string> = {}) =>
      ((await (await app.request(path, { headers })).json()) as { labelers: { id: string }[] }).labelers.map((l) => l.id)
    assert.deepEqual(await ids('/labelers'), ['general', 'spam'], 'на сайте РФ-контура коллегий nsfw/politics нет')
    assert.deepEqual(await ids('/admin/labelers', { authorization: 'Bearer mod' }), ['general', 'nsfw', 'politics', 'spam'], 'модератору — все')
    assert.equal((await app.request('/admin/labelers')).status, 401)
  } finally {
    globalThis.fetch = realFetch
  }
})
