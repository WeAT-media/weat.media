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
