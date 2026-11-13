import type { Plugin } from 'vite'

/**
 * Подтверждение владения сайтом в поисковых кабинетах — meta-теги из окружения сборки:
 *   SITE_VERIFY_GOOGLE  — Google Search Console  (google-site-verification)
 *   SITE_VERIFY_YANDEX  — Яндекс.Вебмастер        (yandex-verification)
 *   SITE_VERIFY_BING    — Bing Webmaster          (msvalidate.01)
 * Несколько кодов одного кабинета — через запятую. GitHub подтверждает домен только
 * DNS-записью — см. deploy/dns.zone.example.
 */
const TAGS: [env: string, name: string][] = [
  ['SITE_VERIFY_GOOGLE', 'google-site-verification'],
  ['SITE_VERIFY_YANDEX', 'yandex-verification'],
  ['SITE_VERIFY_BING', 'msvalidate.01'],
]

// код из кабинета — буквы, цифры, «-» и «_»; всё остальное отвергаем (в HTML попадает как есть)
const TOKEN = /^[A-Za-z0-9_-]{6,128}$/

export function siteVerification(env: NodeJS.ProcessEnv = process.env): Plugin {
  const tags: string[] = []
  for (const [key, name] of TAGS) {
    for (const raw of (env[key] ?? '').split(',').map((s) => s.trim()).filter(Boolean)) {
      if (!TOKEN.test(raw)) throw new Error(`${key}: некорректный код подтверждения «${raw}»`)
      tags.push(`<meta name="${name}" content="${raw}" />`)
    }
  }
  return {
    name: 'site-verification',
    transformIndexHtml: {
      order: 'pre',
      handler: (html) => (tags.length ? html.replace('</head>', `    ${tags.join('\n    ')}\n  </head>`) : html),
    },
  }
}
