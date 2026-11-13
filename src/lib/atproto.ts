import type { Article } from '@/types/types'
import { PDS_URL } from '@/config/site'

export interface AtProtoMeta {
  atUri: string
  cid: string
  originPds: string
  indexedAt: string
  sourceType: NonNullable<Article['sourceType']>
  canonicalId: string
  /** CID в прототипе демонстрационный — не криптографическое доказательство */
  cidIsDemo: boolean
}

const ARTICLE_COLLECTION = 'media.weat.article'

/** Демо-CID: детерминирован от id, явно помечен как демо (bafy…demo…) */
export function demoCid(articleId: string): string {
  let h = 2166136261
  for (const ch of articleId) h = Math.imul(h ^ ch.charCodeAt(0), 16777619)
  return `bafy…demo…${Math.abs(h).toString(36)}`
}

/**
 * Обратносовместимая нормализация ATProto-метаданных статьи:
 * старые записи без полей получают разумные демо-значения
 * (sourceType из article.source, atUri из did автора, canonicalId = atUri).
 */
export function normalizeAtProto(article: Article): AtProtoMeta {
  const sourceType: AtProtoMeta['sourceType'] =
    article.sourceType ?? (article.source ? 'crawler' : 'native-pds')
  const atUri = article.atUri ?? `at://${article.author.did}/${ARTICLE_COLLECTION}/${article.id}`
  return {
    atUri,
    cid: article.cid ?? demoCid(article.id),
    originPds: article.originPds ?? (sourceType === 'native-pds' ? PDS_URL : 'https://pds-demo.extern.example'),
    indexedAt: article.indexedAt ?? article.publishedAt,
    sourceType,
    canonicalId: article.canonicalId ?? atUri,
    cidIsDemo: !article.cid || article.cid.includes('demo'),
  }
}
