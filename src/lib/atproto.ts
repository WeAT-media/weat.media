import type { Article } from '@/types/types'
import { PDS_URL } from '@/config/site'

export interface AtProtoMeta {
  atUri: string
  cid: string
  originPds: string
  indexedAt: string
  sourceType: NonNullable<Article['sourceType']>
  canonicalId: string
  /** записи нет в репозитории (статья только в этом браузере) — CID и AT URI не существуют */
  notInRepo: boolean
  /** старое поле: всегда false — выдуманных CID больше нет */
  cidIsDemo: boolean
}

/**
 * Обратносовместимая нормализация ATProto-метаданных статьи:
 * у записи из индекса — настоящие atUri и cid; статья без записи в репозитории (только в этом браузере)
 * получает «—», а не выдуманные значения.
 */
export function normalizeAtProto(article: Article): AtProtoMeta {
  const sourceType: AtProtoMeta['sourceType'] =
    article.sourceType ?? (article.source ? 'crawler' : 'native-pds')
  const notInRepo = !article.atUri || !article.cid || article.cid.includes('demo')
  const atUri = article.atUri ?? '— (запись ещё не в репозитории)'
  return {
    atUri,
    cid: notInRepo ? '— (запись ещё не в репозитории)' : article.cid!,
    originPds: article.originPds ?? (sourceType === 'native-pds' ? PDS_URL : 'PDS автора'),
    indexedAt: article.indexedAt ?? article.publishedAt,
    sourceType,
    canonicalId: article.canonicalId ?? atUri,
    notInRepo,
    cidIsDemo: false,
  }
}
