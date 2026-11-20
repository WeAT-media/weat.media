/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useMemo, type ReactNode } from 'react'
import { useStore } from '@/lib/store'

const en = {
  feed: 'Feed', hot: 'Trending', collections: 'Collections', court: 'Court', mainNavigation: 'Main navigation', skipToContent: 'Skip to content',
  profile: 'Profile', yourProfile: 'Your profile', logout: 'Log out', login: 'Log in', write: 'Write', settings: 'Settings',
  notifications: 'Notifications', unreadNotifications: (n: number) => `Notifications, ${n} unread`, unread: 'Unread', markAllRead: 'Mark all read',
  notificationsEmpty: 'Nothing here yet. Posts from authors you follow, comments on your posts, and replies to you will appear here.',
  support: 'Support', forYou: 'For you', supportReplied: (subject: string) => `Support replied: “${subject}”`,
  subscribedPost: (title: string) => `New post from a subscribed author: ${title}`,
  commentedPost: (author: string, title: string) => `@${author} commented on your post “${title}”`,
  repliedComment: (author: string, title: string) => `@${author} replied to your comment on “${title}”`,
  post: 'post', language: 'Language', languageDescription: 'Choose the language of menus, buttons, settings, and other interface elements. Posts and comments remain in their original language.',
  russian: 'Русский', english: 'English', notificationSettings: 'Notifications', notificationSettingsDescription: 'Only personal events. You will never receive a notification for every new post.',
  subscribedAuthors: 'Posts by subscribed authors', subscribedAuthorsDescription: 'A new post appears only when you subscribed to its author.',
  commentsOnPosts: 'Comments on your posts', commentsOnPostsDescription: 'Someone leaves a top-level comment on your post.',
  repliesToComments: 'Replies to your comments', repliesToCommentsDescription: 'Someone replies directly to your comment.',
  drafts: 'Drafts', appearance: 'Appearance', history: 'History', editor: 'Editor', importPosts: 'Import posts', jury: 'Jury participation',
  payouts: 'Payouts', adPins: 'Ads in posts', moderation: 'Moderation', linkedAccounts: 'Linked accounts', security: 'Security', developer: 'Developer',
  settingsSections: 'Settings sections', accessDenied: 'Access denied', otherProfileSettings: 'These are another profile’s settings',
  onlyOwnerSettings: 'Only the account owner can change these preferences. The public profile is available to everyone.', mySettings: 'My settings',
  localSettings: 'demo account: settings are stored only in this browser', saving: 'saving…', settingsError: 'could not save to the server — changes exist only in this browser',
  interfaceFont: 'Interface font', theme: 'Theme', accentColor: 'Accent color', currency: 'Currency', default: 'default', systemSerif: 'System serif (Georgia)', monospace: 'Monospace (JetBrains Mono)',
  systemTheme: 'System', lightTheme: 'Light', darkTheme: 'Dark', terracotta: 'Terracotta', forest: 'Forest', indigo: 'Indigo', crimson: 'Crimson',
  currencyDescription: 'Defaults to your country; prices for new paid posts and plans will use this currency',
  all: 'All', text: 'Text', video: 'Video', comments: (n: number) => `${n} comments`, minutesShort: (n: number) => `${n} min`, unlocked: 'Unlocked', paid: 'Paid', publicationLanguage: 'Post language',
  latestActivity: 'Latest activity', newPost: (title: string) => `New post: ${title}`, commented: (author: string, title: string) => `@${author} on “${title}”`, verdict: (number: string, outcome: string) => `${number}: verdict — ${outcome === 'guilty' ? 'guilty' : 'not guilty'}`,
  feedOrigin: 'Source', feedOriginFilter: 'Filter by source', originWeat: 'weAT.media', originStandard: 'Other platforms', originAny: 'Everything', originHint: 'Leaflet, pckt, Offprint and other standard.site platforms', readerPublications: 'Reader posts · AT Protocol', latest: 'Latest', feedSorting: 'Feed sorting', feedFilter: 'Feed filter', withoutCondemned: 'Without condemned', feedFilters: 'Filters, court and moderation', tags: 'Tags', popular: 'Popular', removeTag: (tag: string) => `Remove tag ${tag}`, addTag: (tag: string) => `Add tag ${tag} to the filter`, anySelectedTags: (n: number) => `showing posts with at least one of the tags (${n})`, contentType: 'Content type', contentTypeFilter: 'Filter by content type', languageFilter: 'Filter by language', allLanguages: 'All languages', juryCourt: 'Jury court', noOpenCases: 'No open cases. The feed is clean — for now.', votesOf: (voted: number, total: number, quorum: number) => `Votes ${voted}/${total} · quorum ${quorum}`, yourCollegia: 'Your collegia', trustedVerdicts: (n: number) => `You trust verdicts from ${n} collegia. Each applies its own labels — nobody can delete a post.`, platformPrinciple: 'Platform principle', platformPrincipleText: 'Posts live in their authors’ repositories. A random collegium of 7 readers reviews disputed content, and you decide what to do with verdicts: hide, warn, or ignore.', configure: 'Configure', articles: 'Posts', noFilteredArticles: 'No posts match this filter.', feedPages: 'Feed pages',
  footerMission: 'A community free from everyone: neither the platform nor a moderator can delete your work — disputed verdicts are decided by randomly selected juries.', platform: 'Platform', atmosphere: 'What is ATmosphere', sourceCode: 'Source code · AGPL-3.0', openCases: (n: number) => `Open cases: ${n}`, partners: 'Partners', documentation: 'Documentation', forDesigners: 'For designers', forAdvertisers: 'For advertisers', advertiserDashboard: 'Advertiser dashboard', legalInformation: 'Legal information', governmentRequests: 'Government requests', cookieSettings: 'Cookie settings',
  feedInterface: 'Feed and interface', feedInterfaceSettings: 'Feed and interface settings', feedSort: 'Feed sorting', feedSortDescription: 'By date or by BigData digest popularity.', newestFirst: 'Newest first', hottestFirst: 'Trending first', showCondemned: 'Show condemned posts', showCondemnedHint: 'When off, posts with a “condemned” verdict are removed from the feed.', hideTicker: 'Hide the activity ticker', hideTickerHint: 'The bar below the header disappears completely.', tickerLanguage: 'Activity ticker language', tickerLanguageDescription: 'Event templates can use Russian or English; post titles and @handles stay unchanged. “System” follows the interface language.',
  bookmark: 'Bookmark', bookmarked: 'Bookmarked', removeBookmark: 'Remove bookmark', loginToSave: 'Log in to save', upvotePost: 'Upvote post', upvoteComment: 'Upvote comment', removeVote: 'Remove vote', loginToVote: 'Log in to vote', votesNow: (n: number) => `${n} votes now`, underReview: 'Under review', condemned: 'Condemned', acquitted: 'Acquitted',
} as const

export type TranslationKey = keyof typeof en
type Values = typeof en

type I18nValue = {
  lang: 'ru' | 'en'
  t: <K extends TranslationKey>(key: K, ...args: Values[K] extends (...a: infer A) => string ? A : []) => string
}

const I18nContext = createContext<I18nValue | null>(null)

export function I18nProvider({ children }: { children: ReactNode }) {
  const { prefs } = useStore()
  const value = useMemo<I18nValue>(() => ({
    lang: prefs.uiLang,
    t: ((key: TranslationKey, ...args: unknown[]) => {
      if (prefs.uiLang === 'ru') return key
      const entry = en[key] as string | ((...args: unknown[]) => string)
      return typeof entry === 'function' ? entry(...args) : entry
    }) as I18nValue['t'],
  }), [prefs.uiLang])
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

type Messages = { [K in TranslationKey]: Values[K] extends (...args: infer A) => string ? (...args: A) => string : string }
const ru: Messages = {
  feed: 'Лента', hot: 'Горячее', collections: 'Подборки', court: 'Суд', mainNavigation: 'Основная навигация', skipToContent: 'Перейти к содержимому', profile: 'Профиль', yourProfile: 'Ваш профиль', logout: 'Выйти', login: 'Войти', write: 'Написать', settings: 'Настройки',
  notifications: 'Уведомления', unreadNotifications: (n) => `Уведомления, непрочитанных: ${n}`, unread: 'Непрочитано', markAllRead: 'Прочитать все',
  notificationsEmpty: 'Пока пусто. Здесь появятся новости авторов, комментарии к вашим записям и ответы вам.', support: 'Поддержка', forYou: 'Для вас', supportReplied: (subject) => `Поддержка ответила: «${subject}»`,
  subscribedPost: (title) => `Новая запись по подписке: ${title}`, commentedPost: (author, title) => `@${author} прокомментировал вашу запись «${title}»`, repliedComment: (author, title) => `@${author} ответил на ваш комментарий к «${title}»`, post: 'запись',
  language: 'Язык', languageDescription: 'Выберите язык меню, кнопок, настроек и других элементов интерфейса. Посты и комментарии останутся на языке оригинала.', russian: 'Русский', english: 'English',
  notificationSettings: 'Уведомления', notificationSettingsDescription: 'Только личные события. Уведомления о каждой новой записи не приходят.', subscribedAuthors: 'Записи авторов по подписке', subscribedAuthorsDescription: 'Новая запись появляется, только если вы подписались на её автора.', commentsOnPosts: 'Комментарии к вашим записям', commentsOnPostsDescription: 'Кто-то оставил комментарий к вашей записи.', repliesToComments: 'Ответы на ваши комментарии', repliesToCommentsDescription: 'Кто-то ответил непосредственно на ваш комментарий.',
  drafts: 'Черновики', appearance: 'Внешний вид', history: 'История', editor: 'Редактор', importPosts: 'Импорт постов', jury: 'Участие в суде', payouts: 'Выплаты', adPins: 'Реклама в постах', moderation: 'Модерация', linkedAccounts: 'Связанные аккаунты', security: 'Безопасность', developer: 'Разработчикам', settingsSections: 'Разделы настроек', accessDenied: 'Доступ запрещён', otherProfileSettings: 'Это настройки другого профиля', onlyOwnerSettings: 'Менять предпочтения может только владелец аккаунта. Публичный профиль доступен всем.', mySettings: 'Мои настройки', localSettings: 'демо-аккаунт: настройки только в этом браузере', saving: 'сохраняем…', settingsError: 'не удалось сохранить на сервере — изменения есть только в этом браузере',
  interfaceFont: 'Шрифт интерфейса', theme: 'Тема', accentColor: 'Акцентный цвет', currency: 'Валюта', default: 'по умолчанию', systemSerif: 'Системная антиква (Georgia)', monospace: 'Моноширинный (JetBrains Mono)', systemTheme: 'Как в системе', lightTheme: 'Светлая', darkTheme: 'Тёмная', terracotta: 'Терракота', forest: 'Хвоя', indigo: 'Индиго', crimson: 'Малина', currencyDescription: 'по умолчанию — по стране; цены новых платных статей и тарифов будут в этой валюте',
  all: 'Все', text: 'Текст', video: 'Видео', comments: (n) => `${n} коммент.`, minutesShort: (n) => `${n} мин`, unlocked: 'Доступ открыт', paid: 'Платная', publicationLanguage: 'Язык публикации', latestActivity: 'Последние события', newPost: (title) => `Новая запись: ${title}`, commented: (author, title) => `@${author} к «${title}»`, verdict: (number, outcome) => `${number}: вердикт — ${outcome === 'guilty' ? 'виновна' : 'невиновна'}`,
  feedOrigin: 'Источник', feedOriginFilter: 'Фильтр по источнику', originWeat: 'weAT.media', originStandard: 'Другие площадки', originAny: 'Всё', originHint: 'Leaflet, pckt, Offprint и другие площадки standard.site', readerPublications: 'Публикации читателей · AT Protocol', latest: 'Свежее', feedSorting: 'Сортировка ленты', feedFilter: 'Фильтр ленты', withoutCondemned: 'Без осуждённых', feedFilters: 'Фильтры, суд и модерация', tags: 'Теги', popular: 'Популярное', removeTag: (tag) => `Снять тег ${tag}`, addTag: (tag) => `Добавить тег ${tag} к фильтру`, anySelectedTags: (n) => `показаны записи хотя бы с одним из тегов (${n})`, contentType: 'Тип контента', contentTypeFilter: 'Фильтр по типу контента', languageFilter: 'Фильтр по языку', allLanguages: 'Все языки', juryCourt: 'Суд присяжных', noOpenCases: 'Открытых дел нет. Лента чиста — пока.', votesOf: (voted, total, quorum) => `Голосов ${voted}/${total} · кворум ${quorum}`, yourCollegia: 'Ваши коллегии', trustedVerdicts: (n) => `Вы доверяете вердиктам ${n} коллегий. Каждая метит контент своими метками — удалить статью не может никто.`, platformPrinciple: 'Принцип платформы', platformPrincipleText: 'Статьи живут в репозиториях авторов. Спорный контент рассматривает случайная коллегия из 7 читателей, а вы сами решаете, как поступать с вердиктами: скрывать, предупреждать или игнорировать.', configure: 'Настроить', articles: 'Статьи', noFilteredArticles: 'По этому фильтру статей нет.', feedPages: 'Страницы ленты',
  footerMission: 'Сообщество, свободное от всех: ни площадка, ни модератор не могут удалить вашу работу — спорные вердикты выносят случайные коллегии присяжных.', platform: 'Площадка', atmosphere: 'Что такое ATmosphere', sourceCode: 'Исходный код · AGPL-3.0', openCases: (n) => `Открытых дел: ${n}`, partners: 'Партнёрам', documentation: 'Документация', forDesigners: 'Дизайнерам', forAdvertisers: 'Рекламодателям', advertiserDashboard: 'Кабинет рекламодателя', legalInformation: 'Правовая информация', governmentRequests: 'Запросы органов', cookieSettings: 'Настройки cookie',
  feedInterface: 'Лента и интерфейс', feedInterfaceSettings: 'Настройки ленты и интерфейса', feedSort: 'Сортировка ленты', feedSortDescription: 'По дате или по горячести BigData-дайджеста.', newestFirst: 'Сначала новые', hottestFirst: 'Сначала горячее', showCondemned: 'Показывать осуждённые статьи', showCondemnedHint: 'Если выключено, записи с вердиктом «осуждена» не попадают в ленту вовсе.', hideTicker: 'Скрыть бегущую строку событий', hideTickerHint: 'Строка под шапкой исчезает полностью и не занимает место.', tickerLanguage: 'Язык бегущей строки', tickerLanguageDescription: 'Шаблоны событий на русском или английском; названия записей и @handle остаются оригинальными. «Как в системе» следует языку интерфейса.',
  bookmark: 'В закладки', bookmarked: 'В закладках', removeBookmark: 'Убрать из закладок', loginToSave: 'Войдите, чтобы сохранить', upvotePost: 'Поднять запись', upvoteComment: 'Поднять комментарий', removeVote: 'Снять голос', loginToVote: 'Войдите, чтобы голосовать', votesNow: (n) => `Сейчас ${n} голосов`, underReview: 'На рассмотрении', condemned: 'Осуждена', acquitted: 'Оправдана',
}

export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext)
  if (!ctx) throw new Error('useI18n outside I18nProvider')
  return { ...ctx, t: ((key: TranslationKey, ...args: unknown[]) => ctx.lang === 'ru' ? (typeof ru[key] === 'function' ? (ru[key] as (...a: unknown[]) => string)(...args) : ru[key]) : ctx.t(key, ...args as [])) as I18nValue['t'] }
}
