import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createApp, type Deps } from '../src/app.ts'
import { buildOpenApi, documentedRoutes } from '../src/openapi.ts'

const app = createApp({
  config: { CONTOUR: 'global', PDS_HANDLE_DOMAIN: 'x', TRUST_PROXY: false, CORS_ORIGIN: '', PUBLIC_URL: 'http://x' },
  oauth: {},
  rateLimiter: false,
} as unknown as Deps)

test('every registered route is documented and vice versa', () => {
  const real = new Set(app.routes.filter((r) => r.method !== 'ALL').map((r) => `${r.method} ${r.path.replace(/^\/api/, '')}`))
  const docs = new Set(documentedRoutes())
  assert.deepEqual([...real].filter((r) => !docs.has(r)), [], 'маршрут без документации')
  assert.deepEqual([...docs].filter((r) => !real.has(r)), [], 'документация без маршрута')
})

test('spec is valid-looking OpenAPI 3.1 and served', async () => {
  const spec = buildOpenApi()
  assert.equal(spec.openapi, '3.1.0')
  const login = (spec.paths['/auth/login'] as { post: { requestBody: { content: { 'application/json': { schema: { required: string[] } } } } } }).post
  assert.deepEqual(login.requestBody.content['application/json'].schema.required, ['identifier', 'password'])
  const res = await app.request('/api/openapi.json')
  assert.equal(res.status, 200)
  assert.equal((await res.json()).info.title, 'Indie.media AppView API')
})
