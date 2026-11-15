import test from 'node:test'
import assert from 'node:assert/strict'
import { memoryNotificationRepo, notificationService } from '../src/notifications.js'
import type { SettingsRepo, Settings } from '../src/settings.js'

function settingsRepo(values: Record<string, Settings>): SettingsRepo {
  return {
    async get(did) { return { data: values[did] ?? {}, updatedAt: null } },
    async merge(did, patch) {
      values[did] = { ...values[did], ...patch }
      return { data: values[did], updatedAt: new Date().toISOString() }
    },
  }
}

test('article notifications go only to subscribed followers and honor preferences', async () => {
  const repo = memoryNotificationRepo()
  const service = notificationService(repo, settingsRepo({
    reader: { notificationPrefs: { articles: false, comments: true, replies: true } },
    muted: { notificationPrefs: { articles: false, comments: true, replies: true } },
  }))
  await repo.subscribe('reader', 'author')
  await repo.subscribe('muted', 'author')
  await service.article('author', 'author.test', 'at://author/media.weat.article/1', 'Hello')
  assert.equal((await repo.list('reader', 10)).length, 0)
  assert.equal((await repo.list('muted', 10)).length, 0)
  await repo.subscribe('reader2', 'author')
  await service.article('author', 'author.test', 'at://author/media.weat.article/2', 'Second')
  assert.equal((await repo.list('reader2', 10))[0]?.kind, 'article')
  assert.equal((await repo.list('reader', 10)).length, 0)
})

test('comments notify the post owner and replies notify the parent comment author only', async () => {
  const repo = memoryNotificationRepo()
  const service = notificationService(repo, settingsRepo({}))
  const article = 'at://owner/media.weat.article/1'
  const parent = 'at://commenter/media.weat.comment/1'
  await service.comment({ actorDid: 'reader', actorHandle: 'reader.test', uri: 'at://reader/media.weat.comment/1', articleUri: article })
  assert.equal((await repo.list('owner', 10))[0]?.kind, 'comment')
  await service.comment({ actorDid: 'reader', actorHandle: 'reader.test', uri: 'at://reader/media.weat.comment/2', articleUri: article, parentUri: parent })
  assert.equal((await repo.list('commenter', 10))[0]?.kind, 'reply')
  assert.equal((await repo.list('owner', 10)).length, 1)
  await service.comment({ actorDid: 'commenter', actorHandle: 'commenter.test', uri: 'at://commenter/media.weat.comment/3', articleUri: article, parentUri: parent })
  assert.equal((await repo.list('commenter', 10)).length, 1)
})

test('read markers are private to the recipient', async () => {
  const repo = memoryNotificationRepo()
  const service = notificationService(repo, settingsRepo({}))
  await repo.subscribe('reader', 'author')
  await service.article('author', 'author.test', 'at://author/media.weat.article/1', 'Hello')
  const [notification] = await repo.list('reader', 10)
  await repo.markRead('reader', [notification!.id])
  assert.ok((await repo.list('reader', 10))[0]?.readAt)
  await service.article('author', 'author.test', 'at://author/media.weat.article/2', 'Again')
  await repo.markAllRead('reader')
  assert.ok((await repo.list('reader', 10)).every((n) => n.readAt))
})
