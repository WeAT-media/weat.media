import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readBodyLimited, safeFetch } from '../src/safeFetch.ts'

test('safeFetch: приватные адреса и нестандартные порты отклоняются до подключения', async () => {
  for (const url of ['http://127.0.0.1/', 'https://10.0.0.1/', 'http://169.254.169.254/latest/meta-data', 'https://example.com:8443/']) {
    await assert.rejects(safeFetch(url), url)
  }
})

test('readBodyLimited: читает ответ в пределах лимита', async () => {
  const res = new Response(new Uint8Array([1, 2, 3]))
  assert.deepEqual(await readBodyLimited(res, 3), Buffer.from([1, 2, 3]))
})

test('readBodyLimited: прерывает поток после превышения лимита', async () => {
  let cancelled = false
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(4))
      controller.enqueue(new Uint8Array(4))
    },
    cancel() {
      cancelled = true
    },
  })
  await assert.rejects(readBodyLimited(new Response(stream), 4), /больше/)
  assert.equal(cancelled, true)
})
