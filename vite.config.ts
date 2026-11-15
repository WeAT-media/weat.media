import path from "path"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import { inspectAttr } from 'kimi-plugin-inspect-react'
import { siteVerification } from './vite.siteVerification'

// бренд по умолчанию — для %VITE_SITE_NAME% в index.html (форк задаёт свой в .env)
// старое значение по умолчанию остаётся в env уже запущенного dev-сервера — считаем его незаданным
if (process.env.VITE_SITE_NAME === 'ATProto media') delete process.env.VITE_SITE_NAME
process.env.VITE_SITE_NAME ??= 'weAT.media'
// абсолютный адрес нужен соцсетям для картинки превью (og:image)
process.env.VITE_SITE_URL ??= 'https://weat.media'

// https://vite.dev/config/
export default defineConfig({
  // SPA раздаётся с корня домена: относительный base ломал прямые заходы на
  // вложенные роуты (/case/c114 → /case/assets/… 404 → пустая страница)
  base: '/',
  plugins: [inspectAttr(), react(), siteVerification()],
  server: {
    port: 3000,
    // AT OAuth loopback-клиент возвращает пользователя на http://127.0.0.1:<port>
    host: '127.0.0.1',
    proxy: {
      // только /api/*: сама страница /api — маршрут SPA (документация)
      '^/api/.*': 'http://localhost:8787',
      // админ-API краулера (services/crawler)
      '^/crawler-api/.*': 'http://localhost:8788',
      '^/analytics-api/.*': 'http://localhost:8789',
      '^/rss/.*': 'http://localhost:8790',
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    rollupOptions: {
      output: {
        // BlockSuite (редактор) и его зависимости — отдельный чанк: имя (хеш) меняется только при обновлении
        // библиотеки, а не при каждом деплое сайта, — браузер держит его в кэше (/assets/* — immutable, 1 год).
        // Подсветка кода (shiki: языки, темы) остаётся ленивой — по чанку на язык.
        manualChunks(id) {
          // служебные помощники сборки нужны всем страницам — иначе Rollup кладёт их в чанк редактора,
          // и вход сайта статически тянет весь BlockSuite
          if (id.includes('commonjsHelpers') || id.includes('preload-helper')) return 'runtime'
          if (!id.includes('node_modules')) return
          // зависимости редактора, которые нужны и сайту (всплывающие окна Radix — floating-ui и др.): свой чанк,
          // иначе Rollup забирает их в blocksuite и страницы без редактора тянут его целиком
          const shared = /node_modules\/(?:\.pnpm\/[^/]+\/node_modules\/)?(@floating-ui|date-fns|dompurify|zod|nanoid)\//.exec(id)
          if (shared) return `vendor-${shared[1]!.replace('@', '')}`
          if (/node_modules\/(\.pnpm\/[^/]+\/node_modules\/)?(shiki|@shikijs)\//.test(id)) return
          if (/node_modules\/(\.pnpm\/[^/]+\/node_modules\/)?(@blocksuite|@toeverything|@lit|lit|lit-html|lit-element|@lit-labs|yjs|lib0|y-protocols)\//.test(id)) return 'blocksuite'
        },
      },
    },
  },
});
