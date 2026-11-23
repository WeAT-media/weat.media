import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Hono } from 'hono'
import sharp from 'sharp'
import { isPublicAddress, mountImageProxyRoute, parsePreview } from '../src/linkPreview.ts'

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

test('image-proxy: WebP по Accept, оригинал без него, кэш отдельного варианта', async () => {
  const png = await sharp({ create: { width: 16, height: 16, channels: 4, background: '#bc773f' } }).png().toBuffer()
  let calls = 0
  const app = new Hono()
  mountImageProxyRoute(app, {
    fetch: async () => {
      calls++
      return new Response(png, { headers: { 'content-type': 'image/png; charset=binary' } })
    },
  })
  const target = '/image-proxy?url=https%3A%2F%2Fexample.com%2Fcover.png'
  const webp = await app.request(target, { headers: { accept: 'image/avif,image/webp,*/*' } })
  assert.equal(webp.status, 200)
  assert.equal(webp.headers.get('content-type'), 'image/webp')
  assert.equal(webp.headers.get('vary'), 'Accept')
  assert.equal((await sharp(await webp.arrayBuffer()).metadata()).format, 'webp')

  const original = await app.request(target, { headers: { accept: 'image/*' } })
  assert.equal(original.headers.get('content-type'), 'image/png')
  assert.deepEqual(Buffer.from(await original.arrayBuffer()), png)

  const cached = await app.request(target, { headers: { accept: 'image/webp' } })
  assert.equal(cached.headers.get('content-type'), 'image/webp')
  assert.equal(calls, 3)
})

test('image-proxy: SVG не перекодируется', async () => {
  const app = new Hono()
  mountImageProxyRoute(app, {
    fetch: async () => new Response('<svg xmlns="http://www.w3.org/2000/svg"/>', { headers: { 'content-type': 'image/svg+xml' } }),
  })
  const res = await app.request('/image-proxy?url=https%3A%2F%2Fexample.com%2Ficon.svg', { headers: { accept: 'image/webp' } })
  assert.equal(res.headers.get('content-type'), 'image/svg+xml')
  assert.match(res.headers.get('content-security-policy') ?? '', /sandbox/)
})
