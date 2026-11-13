export type LabelAction = 'hide' | 'warn' | 'ignore'

export type VerdictStatus = 'clear' | 'trial' | 'guilty' | 'acquitted'

export type BlockType = 'p' | 'h2' | 'code' | 'quote' | 'ul' | 'poll' | 'mdx' | 'carousel' | 'callout' | 'userblock' | 'image' | 'ivideo' | 'faq' | 'button'

/** Видео в плейлисте статьи: свое (native Video.js) или внешняя площадка */
export interface VideoItem {
  id: string
  title: string
  /** описание с таймкодами (пока — только native-плеер умеет кликабельные таймкоды) */
  description?: string
  source: 'native' | 'youtube' | 'loom'
  /** native: URL/демо-источник */
  src?: string
  /** внешние: id видео на площадке */
  videoId?: string
  /** длительность, сек */
  duration?: number
  /** что умеет аналитика площадки: native отдаёт retention/CTR, внешние — нет */
  analyticsCapabilities: { retention: boolean; ctr: boolean }
}

export interface ArticleBlock {
  type: BlockType
  text: string
  lang?: string
  /** для type=mdx — имя компонента (cta, note, ...) */
  component?: string
  /** для type=image: text — адрес, alt — подпись */
  alt?: string
}

export interface Author {
  name: string
  handle: string
  did: string
}

export interface Comment {
  id: string
  author: string
  text: string
  at: string
  /** ответ на комментарий (id родителя); у старых записей отсутствует */
  parentId?: string
}

export interface Paywall {
  /** цена в основных единицах валюты */
  price: number
  /** валюта цены; у старых записей отсутствует = RUB */
  currency?: 'RUB' | 'USD' | 'EUR'
  period: 'once' | 'month'
  /** one-time покупка или подписка на тир; у старых записей отсутствует = one-time */
  accessType?: 'one-time' | 'subscription'
  tierId?: string
  tierName?: string
  /** id закрытой части на площадке (pc_…): есть — покупка идёт через lava.top, нет — демо */
  privateContentId?: string
}

/** Тарифный уровень месячной подписки автора (локальный мок) */
export interface SubscriptionTier {
  id: string
  name: string
  priceMonthly: number
  /** валюта тарифа; у старых тарифов отсутствует = RUB */
  currency?: 'RUB' | 'USD' | 'EUR'
  description: string
  archived?: boolean
}

/** Источник репоста / краулера */
export interface SourceRef {
  url: string
  label: string
}

/** GEO-ограничение по решению суда */
export interface GeoBlock {
  regions: string[]
  courtRef: string
  reason: string
}

import type { LanguageCode } from '@/data/languages'

export type ArticleLanguage = LanguageCode

export interface Article {
  id: string
  title: string
  subtitle?: string
  author: Author
  publishedAt: string
  /** ISO-дата отложенной публикации; статья в ленте только когда наступит */
  publishAt?: string
  /** язык публикации; у старых записей может отсутствовать — считаем 'ru' */
  language?: ArticleLanguage
  tags: string[]
  readingTime: number
  verdict: VerdictStatus
  verdictLabel?: string
  caseId?: string
  excerpt: string
  blocks: ArticleBlock[]
  comments: Comment[]
  kind?: 'text' | 'video'
  videoUrl?: string
  /** описание видео (caption под плеером) */
  videoDescription?: string
  /** источник видео: ссылка или локальный файл; файл живёт только в сессии загрузки */
  videoSource?: 'link' | 'file'
  videoFileName?: string
  /** бесплатный превью-отрезок платного видео, в секундах */
  videoPreviewRange?: { start: number; end: number }
  /** плейлист видео (несколько площадок в одном посте); старые videoUrl/* выше — legacy одиночного видео */
  videos?: VideoItem[]
  /** бесплатный тизер платной статьи — показывается до пейволла вместо body */
  teaser?: string
  /** AT Protocol: полный AT URI записи (at://did/collection/rkey) */
  atUri?: string
  /** CID записи; в прототипе — демо-значение, не криптографическое доказательство */
  cid?: string
  /** PDS, где живёт оригинал записи */
  originPds?: string
  /** когда AppView проиндексировал запись */
  indexedAt?: string
  /** происхождение: свой PDS / внешний PDS / краулер / репост */
  sourceType?: 'native-pds' | 'external-pds' | 'crawler' | 'repost'
  /** канонический идентификатор публикации (при репосте/импорте — оригинал) */
  canonicalId?: string
  /** соавтор статьи, свободный текст */
  coAuthor?: string
  /** редактор статьи, напр. "claude" */
  editor?: string
  paywall?: Paywall
  source?: SourceRef
  collectionId?: string
  geoBlock?: GeoBlock
  /** пришла из индекса ленты (настоящая запись PDS), а не из демо-данных */
  fromIndex?: boolean
  /** полное время публикации (ISO) для сортировки; publishedAt — только дата для показа */
  publishedAtFull?: string
  /** карточка из ленты: текст статьи ещё не загружен (подгружается на странице статьи) */
  bodyPending?: boolean
  /** из индекса ленты: лайки media.weat.like и комментарии всех читателей */
  likeCount?: number
  commentCount?: number
  /** лайк читателя уже учтён в likeCount (по данным сервера на момент загрузки ленты) */
  likedByMe?: boolean
}

export interface Collection {
  id: string
  title: string
  description: string
  authorHandle: string
  articleIds: string[]
}

export type VoteValue = 'guilty' | 'clear'

export interface CaseFile {
  id: string
  number: string
  articleId: string
  articleTitle: string
  charges: string
  openedAt: string
  quorum: number
  jurorsTotal: number
  baseGuilty: number
  baseClear: number
  status: 'open' | 'closed'
  outcome?: VoteValue
  labelValue?: string
  /** коллегия, в которую подано дело */
  collegiumId?: string
}

export interface LabelerLabel {
  value: string
  description: string
  defaultAction: LabelAction
}

export interface Labeler {
  id: string
  name: string
  handle: string
  description: string
  subscribers: number
  labels: LabelerLabel[]
}

export interface LabelerSettings {
  subscribed: boolean
  actions: Record<string, LabelAction>
}

export interface User {
  name: string
  handle: string
  did: string
  premium: boolean
  /** стаж подписки в месяцах (для опросов «не менее 5 мес») */
  premiumSinceMonths?: number
  /** ISO-дата регистрации (AppView) */
  createdAt?: string
  /** ISO 3166-1 alpha-2 по GeoIP при регистрации; 'ZZ' — не определена */
  signupCountry?: string
}

/** Централизованные пользовательские настройки (persisted в localStorage) */
export interface Preferences {
  font: 'sans' | 'serif' | 'mono'
  appearance: 'light' | 'dark' | 'system'
  accent: 'terracotta' | 'forest' | 'indigo' | 'crimson'
  /** язык интерфейса; перевода текстов пока нет — применяется к chrome/метаданным */
  uiLang: 'ru' | 'en'
  feedSort: 'new' | 'hot'
  /** показывать осуждённые статьи в ленте */
  showCondemned: boolean
  /** скрыть бегущую строку событий */
  hideTicker: boolean
  /** язык шаблонов бегущей строки: system следует uiLang */
  tickerLang: 'system' | 'ru' | 'en'
  /** выбранные теги фильтра ленты (ANY: хотя бы один) */
  feedTags: string[]
  /** валюта цен для пользователя; по умолчанию — по стране, выбирается независимо от неё */
  currency: 'RUB' | 'USD' | 'EUR'
  /** экспериментальные функции: интерактивное видео и т. п. */
  devPreview?: boolean
  /** вести историю прочтений; нет поля — ведём */
  historyEnabled?: boolean
}

/** «Продолжить с места»: секунда, длительность и когда смотрел (мс) — синхронизируется между устройствами */
export interface VideoProgressEntry {
  t: number
  d?: number
  at: number
}

/** Запись истории прочтений: приватна, видна только в своём профиле */
export interface ReadEntry {
  id: string
  uri?: string
  title: string
  author?: string
  kind: 'text' | 'video'
  at: number
}

export const defaultPreferences: Preferences = {
  font: 'sans',
  appearance: 'light',
  accent: 'terracotta',
  uiLang: 'ru',
  feedSort: 'new',
  showCondemned: true,
  hideTicker: false,
  tickerLang: 'system',
  feedTags: [],
  currency: 'RUB',
}

export type ReportTargetType = 'article' | 'comment' | 'user'

export type CalloutTone = 'info' | 'success' | 'warning' | 'danger'

/** Premium-настройки визуального редактора (persisted в localStorage) */
export interface EditorPreferences {
  /** кастомные BlockSuite-блоки (карусель, опрос, callout) доступны в «/»-меню */
  customBlocks: boolean
  /** тон по умолчанию для новых callout-блоков */
  calloutVariant: CalloutTone
  /** иконка по умолчанию для новых callout-блоков */
  calloutIcon: string
}

export const defaultEditorPreferences: EditorPreferences = {
  customBlocks: true,
  calloutVariant: 'info',
  calloutIcon: '💡',
}
export type ReportReason = 'spam' | 'harassment' | 'illegal' | 'copyright' | 'other'

export interface Report {
  id: string
  targetType: ReportTargetType
  targetId: string
  /** человекочитаемая подпись цели (заголовок, @handle, текст комментария) */
  targetLabel: string
  reason: ReportReason
  details: string
  status: 'pending'
  reporterHandle: string
  createdAt: string
}

export interface SupportTicket {
  id: string
  kind: 'support' | 'legal'
  category: string
  email: string
  handle?: string
  articleUrl?: string
  subject: string
  message: string
  /** смена страны регистрации: текущая и новая страна */
  countryFrom?: string
  countryTo?: string
  /** тип подтверждающего документа */
  docType?: 'passport' | 'registration' | 'residence-permit' | 'other'
  /** только метаданные файла — содержимое документа в прототипе не сохраняется */
  docFile?: { name: string; size: number; type: string }
  createdAt: string
  status: 'received-demo' | 'verification-pending'
}
