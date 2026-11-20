import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRestrictedFilter } from '../src/restricted.ts'

const ours = 'at://did:plc:abcdefghijkl123456/media.weat.article/3kabc'
const labeled = 'at://did:plc:abcdefghijkl123456/media.weat.article/3knsfw'
const external = 'at://did:plc:zzzzzzzzzzzzzzzzzzzzzzzz/site.standard.document/3kext'

test('RU contour: standard.site documents always closed, even with the labeler down; ours decided by labels', async () => {
  const realFetch = globalThis.fetch
  let calls = 0
  let down = false
  globalThis.fetch = (async (url: URL | string) => {
    calls++
    if (down) throw new Error('labeler down')
    const u = String(url)
    if (u.includes('app.weat.labeler.describe')) return new Response(JSON.stringify({ labelers: [{ id: 'nsfw', did: 'did:web:nsfw.justice.weat.media' }] }))
    const asked = new URL(u).searchParams.get('uriPatterns')!.split(',')
    assert.ok(!asked.includes(external), 'внешний документ у лейблера не спрашиваем')
    return new Response(JSON.stringify({ labels: asked.filter((x) => x === labeled).map((uri) => ({ uri })) }))
  }) as typeof fetch
  try {
    const ru = createRestrictedFilter({ enabled: true, labelerUrl: 'http://labeler.test', ttlMs: 0 })
    assert.deepEqual([...(await ru.blocked([ours, labeled, external]))].sort(), [labeled, external].sort())
    down = true
    const fresh = 'at://did:plc:abcdefghijkl123456/media.weat.article/3knew'
    const blocked = await ru.blocked([ours, labeled, external, fresh])
    assert.ok(blocked.has(external), 'лейблер недоступен — внешний всё равно закрыт')
    assert.ok(!blocked.has(ours), 'проверенная чистой — видна, лента не пустеет')
    assert.ok(blocked.has(labeled), 'известная закрытая — закрыта')
    assert.ok(blocked.has(fresh), 'не проверенная во время сбоя — закрыта')

    const noLabeler = createRestrictedFilter({ enabled: true })
    assert.deepEqual([...(await noLabeler.blocked([ours, external]))], [external], 'и без адреса лейблера')

    calls = 0
    const global = createRestrictedFilter({ enabled: false, labelerUrl: 'http://labeler.test' })
    assert.equal((await global.blocked([ours, external])).size, 0, 'глобальный контур: решает читатель')
    assert.equal(calls, 0)
  } finally {
    globalThis.fetch = realFetch
  }
})
