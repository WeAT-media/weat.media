import assert from 'node:assert/strict'
import { test } from 'node:test'
import { isPublicAddress, parsePreview } from '../src/linkPreview.ts'

test('parsePreview: og-теги, сущности, абсолютные ссылки', () => {
  const html = `<html><head><title>Запасной</title>
    <meta property="og:title" content="Статья &amp; &#x41D;овости">
    <meta name="description" content="Описание">
    <meta property="og:image" content="/img/cover.png">
    <link rel="icon" href="/favicon.svg"></head><body>…</body></html>`
  assert.deepEqual(parsePreview(html, 'https://example.com/a/b'), {
    url: 'https://example.com/a/b',
    title: 'Статья & Новости',
    description: 'Описание',
    image: 'https://example.com/img/cover.png',
    icon: 'https://example.com/favicon.svg',
  })
})

test('parsePreview: без og — <title>, javascript: не пропускаем', () => {
  const p = parsePreview('<title> Просто страница </title><meta property="og:image" content="javascript:alert(1)">', 'https://x.org/')
  assert.equal(p.title, 'Просто страница')
  assert.equal(p.image, null)
})

test('isPublicAddress: внутренние сети закрыты', () => {
  for (const ip of ['127.0.0.1', '10.0.0.5', '192.168.1.1', '169.254.169.254', '::1', '::ffff:127.0.0.1', 'fc00::1']) assert.equal(isPublicAddress(ip), false, ip)
  assert.equal(isPublicAddress('1.1.1.1'), true)
})
