import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Hono } from 'hono'
import { createFeedStream, mountFeedStreamRoute } from '../src/feedStream.ts'

const uri = (k: string) => `at://did:plc:abcdefghijkl123456/media.weat.article/${k}`

test('feed stream: reconnect with Last-Event-ID replays missed events; unknown id → lagged', async () => {
  const stream = createFeedStream({})
  const seen: string[] = []
  const off = stream.listen((_e, _d, id) => seen.push(id))
  for (const k of ['a', 'b', 'c']) stream.emit({ type: 'created', uri: uri(k), title: k })
  await new Promise((r) => setTimeout(r, 10))
  off()
  assert.equal(seen.length, 3)
  assert.deepEqual(stream.since(seen[0]!)!.map((e) => JSON.parse(e.data).title), ['b', 'c'])
  assert.deepEqual(stream.since(seen[2]!), [])
  assert.equal(stream.since('other-1'), null, 'id от прошлого запуска')

  const app = new Hono()
  mountFeedStreamRoute(app, stream)
  const ctrl = new AbortController()
  const res = await app.request('/feed/stream', { headers: { 'last-event-id': seen[1]! }, signal: ctrl.signal })
  const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader()
  let buf = ''
  while (!/event: created\ndata: [^\n]*"title":"c"/.test(buf)) buf += (await reader.read()).value ?? ''
  assert.doesNotMatch(buf, /"title":"b"/, 'уже полученное не повторяется')
  assert.match(buf, new RegExp(`id: ${seen[2]}`))
  await reader.cancel()
  ctrl.abort()

  const ctrl2 = new AbortController()
  const stale = await app.request('/feed/stream', { headers: { 'last-event-id': 'zzz-1' }, signal: ctrl2.signal })
  const r2 = stale.body!.pipeThrough(new TextDecoderStream()).getReader()
  let b2 = ''
  while (!b2.includes('event: lagged')) b2 += (await r2.read()).value ?? ''
  await r2.cancel()
  ctrl2.abort()
})
