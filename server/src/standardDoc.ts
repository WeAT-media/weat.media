import type { PdsClient } from './pds.js'
import { ARTICLE_COLLECTION } from './paidContent.js'
import { plainExcerpt } from './share.js'

/**
 * Копия бесплатной статьи в общем лексиконе длинных текстов AT Protocol (standard.site, lexicons/site.standard.document.json):
 * её видят другие клиенты этого лексикона, а читать полностью ведут на weat.media.
 * Тот же rkey, что у media.weat.article, — по нему копию обновляют и удаляют вместе со статьёй.
 * Платные (paywall), приватные и noindex не копируются: публичная копия раскрыла бы текст или нарушила выбор автора.
 */
export const STANDARD_DOC_COLLECTION = 'site.standard.document'

/** поле-метка: копия сделана weat.media с этой статьи — лента не индексирует её второй раз */
export const WEAT_ORIGIN_FIELD = 'weatArticle'

const TEXT_MAX = 100_000

/**
 * автор снял галочку «Опубликовать также в standard.site»: метка живёт только в записи на охлаждении
 * (cooldown) и вырезается перед записью в PDS — в репозиторий автора она не попадает
 */
export const STANDARD_OPT_OUT_FIELD = '$weatNoStandardSite'

/** markdown → простой текст с абзацами (textContent не должен содержать разметку) */
export function plainText(md: string, max = TEXT_MAX): string {
  const text = md
    .replace(/\r/g, '')
    // блоки кода и наши JSON-блоки (опрос, кнопка, карусель) — не текст
    .replace(/```[\s\S]*?```/g, '\n\n')
    .split(/\n{2,}/)
    .map((p) => plainExcerpt(p, Number.MAX_SAFE_INTEGER))
    .filter(Boolean)
    .join('\n\n')
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text
}

export function standardDocument(record: Record<string, unknown>, did: string, rkey: string, siteUrl: string): Record<string, unknown> | null {
  if (record.paywall || record.privateContent || record.noindex) return null
  const title = typeof record.title === 'string' ? record.title.trim() : ''
  const text = typeof record.text === 'string' ? record.text : ''
  const createdAt = typeof record.createdAt === 'string' ? record.createdAt : new Date().toISOString()
  if (!title) return null
  const description = [record.subtitle, record.excerpt].find((v): v is string => typeof v === 'string' && v.trim() !== '')
  const tags = Array.isArray(record.tags) ? record.tags.filter((t): t is string => typeof t === 'string' && t !== '').slice(0, 20) : []
  return {
    $type: STANDARD_DOC_COLLECTION,
    site: siteUrl.replace(/\/$/, ''),
    path: `/article/${rkey}-${did.slice(-6)}`,
    title: title.slice(0, 500),
    ...(description ? { description: plainExcerpt(description, 3000) } : {}),
    textContent: plainText(text),
    ...(tags.length ? { tags } : {}),
    publishedAt: createdAt,
    [WEAT_ORIGIN_FIELD]: `at://${did}/${ARTICLE_COLLECTION}/${rkey}`,
  }
}

/**
 * at:// копии для <link rel="site.standard.document"> на странице статьи — так клиенты standard.site проверяют,
 * что документ действительно принадлежит странице (standard.site → Verification). null — копии нет.
 */
export function standardDocUri(uri: string, record: Record<string, unknown>): string | null {
  const m = /^at:\/\/(did:[a-z]+:[A-Za-z0-9._:%-]+)\/media\.weat\.article\/([A-Za-z0-9._~:-]+)$/.exec(uri)
  if (!m || !standardDocument(record, m[1]!, m[2]!, 'https://x')) return null
  // импорт краулера пишет не наш сервер — копии у него нет
  const source = record.source as { crawledAt?: unknown } | undefined
  if (source?.crawledAt) return null
  return `at://${m[1]}/${STANDARD_DOC_COLLECTION}/${m[2]}`
}

/** копия не должна ломать публикацию: ошибка PDS только в лог */
export async function mirrorStandardDoc(pds: PdsClient, accessJwt: string, did: string, rkey: string, record: Record<string, unknown>, siteUrl: string) {
  const doc = standardDocument(record, did, rkey, siteUrl)
  if (!doc) {
    await pds.deleteRecord(accessJwt, did, STANDARD_DOC_COLLECTION, rkey).catch(() => {})
    return
  }
  await pds.putRecord(accessJwt, did, STANDARD_DOC_COLLECTION, rkey, doc).catch((e) => console.warn('site.standard.document mirror failed', did, rkey, e))
}

export async function unmirrorStandardDoc(pds: PdsClient, accessJwt: string, did: string, rkey: string) {
  await pds.deleteRecord(accessJwt, did, STANDARD_DOC_COLLECTION, rkey).catch(() => {})
}
