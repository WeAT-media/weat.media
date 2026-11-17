import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createCooldown, memCooldown, pendingSource } from '../src/cooldown.ts'
import { createSecretBox } from '../src/secretbox.ts'

test('pendingSource: own pending + peer contour pending; peer down — own only', async () => {
  const repo = memCooldown()
  const cooldown = createCooldown({ pds: {} as never, secrets: createSecretBox('22'.repeat(32)), repo })
  await repo.insert({ uri: 'at://did:plc:nl/media.weat.article/aaa', did: 'did:plc:nl', handle: 'nl.weat.media', collection: 'media.weat.article', rkey: 'aaa', record: { title: 'NL' }, visible_at: new Date(Date.now() - 1000), publish_at: new Date(Date.now() + 3600_000) })
  // отложенная, ещё не вышла — читателям не видна
  await repo.insert({ uri: 'at://did:plc:nl/media.weat.article/bbb', did: 'did:plc:nl', handle: 'nl.weat.media', collection: 'media.weat.article', rkey: 'bbb', record: { title: 'later' }, visible_at: new Date(Date.now() + 3600_000), publish_at: new Date(Date.now() + 7200_000) })
  let up = true
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    assert.equal(url, 'https://ru.weat.media/api/peer/cooldown')
    assert.equal((init?.headers as Record<string, string>)['x-indie-peer-hop'], '1')
    if (!up) throw new Error('down')
    return new Response(JSON.stringify({ items: [{ uri: 'at://did:plc:ru/media.weat.article/ccc', did: 'did:plc:ru', handle: 'ru.weat.media', collection: 'media.weat.article', record: { title: 'RU' } }] }))
  }) as typeof fetch
  const src = pendingSource({ cooldown, peerUrl: 'https://ru.weat.media', fetchImpl })
  assert.deepEqual((await src.list('media.weat.article')).map((i) => i.record.title), ['NL', 'RU'])
  assert.equal((await src.get('at://did:plc:ru/media.weat.article/ccc'))?.record.title, 'RU')
  assert.equal(await src.get('at://did:plc:nl/media.weat.article/bbb'), undefined, 'отложенная не видна')
  up = false
  const own = pendingSource({ cooldown, peerUrl: 'https://ru.weat.media', fetchImpl })
  assert.deepEqual((await own.list('media.weat.article')).map((i) => i.record.title), ['NL'])
})

test('scheduled post: AT at the scheduled time (≥24h), visible on the site 24h before', async () => {
  const repo = memCooldown()
  await repo.setCreds('did:plc:a', 'x', 'weat-cooldown')
  const cooldown = createCooldown({ pds: {} as never, secrets: createSecretBox('22'.repeat(32)), repo })
  const s = { token: 't', did: 'did:plc:a', handle: 'a.weat.media' }
  const H = 3600_000
  const t0 = Date.now()
  const far = await cooldown.hold(s, 'media.weat.article', { title: 'far' }, new Date(t0 + 72 * H))
  assert.ok(Math.abs(far!.publish_at.getTime() - (t0 + 72 * H)) < 2000, 'в AT — в назначенное время')
  assert.ok(Math.abs(far!.visible_at.getTime() - (t0 + 48 * H)) < 2000, 'на сайте — за сутки до')
  const soon = await cooldown.hold(s, 'media.weat.article', { title: 'soon' }, new Date(t0 + 2 * H))
  assert.ok(soon!.visible_at.getTime() <= Date.now() + 1000, 'меньше суток — на сайте сразу')
  assert.ok(Math.abs(soon!.publish_at.getTime() - (t0 + 2 * H)) < 2000, 'в AT — ровно в назначенное время')
  const plain = await cooldown.hold(s, 'media.weat.article', { title: 'plain' })
  assert.ok(plain!.publish_at.getTime() >= t0 + 24 * H - 2000, 'обычная — охлаждение сутки')
})
