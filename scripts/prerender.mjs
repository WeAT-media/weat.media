import { readFile, writeFile } from 'node:fs/promises'
import { createServer } from 'vite'

process.env.NODE_ENV = 'production'
const server = await createServer({
  mode: 'production',
  server: { middlewareMode: true },
  appType: 'custom',
})

try {
  const { renderLanding } = await server.ssrLoadModule('/src/entry-prerender.tsx')
  const html = await readFile('dist/index.html', 'utf8')
  const landing = renderLanding()
  const output = html.replace('<div id="root"></div>', `<div id="root">${landing}</div>`)
  if (output === html) throw new Error('Root element was not found in dist/index.html')
  await writeFile('dist/app.html', html)
  await writeFile('dist/index.html', output)
  console.log(`Prerendered landing: ${(Buffer.byteLength(landing) / 1024).toFixed(1)} KiB HTML`)
} finally {
  await server.close()
}
