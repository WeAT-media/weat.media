import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mirrorStandardDoc, standardDocument, plainText } from '../src/standardDoc.ts'
import type { PdsClient } from '../src/pds.ts'

const did = 'did:plc:abcdefghijkl123456'

test('site.standard.document: free article mirrored with link back, plain text with paragraphs', () => {
  const doc = standardDocument(
    { title: ' Заголовок ', subtitle: 'Подзаголовок', text: '# Раз\n\nТекст **жирный** и [ссылка](https://x.y).\n\n```poll\n{"q":1}\n```\n\nКонец', tags: ['a', 'b'], createdAt: '2026-11-20T10:00:00.000Z' },
    did,
    '3kabc',
    'https://weat.media/',
  )
  assert.ok(doc)
  assert.equal(doc.$type, 'site.standard.document')
  assert.equal(doc.site, 'https://weat.media')
  assert.equal(doc.path, '/article/3kabc-123456')
  assert.equal(doc.title, 'Заголовок')
  assert.equal(doc.description, 'Подзаголовок')
  assert.equal(doc.textContent, 'Раз\n\nТекст жирный и ссылка.\n\nКонец')
  assert.equal(doc.publishedAt, '2026-11-20T10:00:00.000Z')
  assert.equal(doc.weatArticle, `at://${did}/media.weat.article/3kabc`)
})

test('site.standard.document: paid, private and noindex articles are not mirrored', () => {
  const base = { title: 't', text: 'x', createdAt: '2026-11-20T10:00:00.000Z' }
  assert.equal(standardDocument({ ...base, paywall: { accessType: 'one-time', price: 100 } }, did, 'k', 'https://weat.media'), null)
  assert.equal(standardDocument({ ...base, privateContent: true }, did, 'k', 'https://weat.media'), null)
  assert.equal(standardDocument({ ...base, noindex: true }, did, 'k', 'https://weat.media'), null)
  assert.equal(standardDocument({ ...base, title: '  ' }, did, 'k', 'https://weat.media'), null)
})

test('plainText: truncates long text', () => {
  assert.equal(plainText('a'.repeat(20), 10).length, 10)
})


test('site.standard.document: closing a mirrored article removes the public copy', async () => {
  const deleted: string[][] = []
  const pds = {
    deleteRecord: async (...args: string[]) => {
      deleted.push(args)
    },
  } as unknown as PdsClient
  await mirrorStandardDoc(pds, 'token', did, '3kabc', { title: 'Private', text: 'secret', noindex: true }, 'https://weat.media')
  assert.deepEqual(deleted, [['token', did, 'site.standard.document', '3kabc']])
})

test('standardDocUri: link only for free native articles', async () => {
  const { standardDocUri } = await import('../src/standardDoc.ts')
  const uri = 'at://did:plc:abcdefghijkl123456/media.weat.article/3kabc'
  const base = { title: 't', text: 'x', createdAt: '2026-11-20T10:00:00.000Z' }
  assert.equal(standardDocUri(uri, base), 'at://did:plc:abcdefghijkl123456/site.standard.document/3kabc')
  assert.equal(standardDocUri(uri, { ...base, paywall: { price: 1 } }), null)
  assert.equal(standardDocUri(uri, { ...base, noindex: true }), null)
  assert.equal(standardDocUri(uri, { ...base, source: { url: 'https://x', crawledAt: '2026-11-01T00:00:00Z' } }), null)
  assert.equal(standardDocUri('at://did:plc:x/site.standard.document/k', base), null)
})
