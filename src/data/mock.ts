import type { Labeler, User } from '@/types/types'

/** id — ключи настроек модерации у читателей (не менять); handle — адрес сервиса коллегии (services/labeler) */
export const labelers: Labeler[] = [
  {
    id: 'collegium-fraud',
    name: 'Коллегия по накруткам и спаму',
    handle: 'spam.justice.weat.media',
    description:
      'Разбирает искусственный рейтинг: купленные голоса, ботов, накрутку просмотров и подписчиков. Присяжные смотрят агрегированную аналитику без персональных данных.',
    subscribers: 9420,
    labels: [
      { value: 'verdict.upvote-fraud', description: 'Накрутка рейтинга и голосов', defaultAction: 'hide' },
      { value: 'verdict.view-fraud', description: 'Накрутка просмотров, боты, купленные подписчики', defaultAction: 'warn' },
    ],
  },
  {
    id: 'collegium-tech',
    name: 'Техническая экспертиза',
    handle: 'tech.justice.weat.media',
    description:
      'Коллегия из практикующих инженеров. Проверяет код-примеры из статей: компилирует, запускает, замеряет. Метит статьи с нерабочим кодом и поверхностной экспертизой.',
    subscribers: 6312,
    labels: [
      { value: 'verdict.insufficient-expertise', description: 'Недостаточная техническая экспертиза: ошибки, поверхностные выводы', defaultAction: 'warn' },
      { value: 'verdict.broken-code', description: 'Код из статьи не работает или искажён', defaultAction: 'warn' },
      { value: 'verdict.fake-benchmarks', description: 'Сфабрикованные бенчмарки', defaultAction: 'hide' },
    ],
  },
  {
    id: 'collegium-law',
    name: 'Коллегия по законности',
    handle: 'law.justice.weat.media',
    description:
      'Рассматривает возможные нарушения закона: запрещённый контент, авторские права, раскрытие персональных данных. Метка не заменяет решение суда государства.',
    subscribers: 7105,
    labels: [
      { value: 'verdict.illegal', description: 'Нарушение закона', defaultAction: 'hide' },
      { value: 'verdict.copyright', description: 'Нарушение авторских прав', defaultAction: 'hide' },
      { value: 'verdict.personal-data', description: 'Раскрытие персональных данных без согласия', defaultAction: 'hide' },
    ],
  },
  {
    id: 'collegium-tone',
    name: 'Коллегия тона и манеры',
    handle: 'tone.justice.weat.media',
    description:
      'Судит споры о токсичности, переходах на личности и рекламном тоне. Самая спорная коллегия — подписка только по желанию.',
    subscribers: 2890,
    labels: [
      { value: 'verdict.promo', description: 'Скрытая реклама без маркировки', defaultAction: 'warn' },
      { value: 'verdict.toxic', description: 'Токсичность, переход на личности', defaultAction: 'ignore' },
    ],
  },
  {
    // id сохранён: на него ссылаются старые дела и настройки модерации
    id: 'collegium-main',
    name: 'Общая коллегия',
    handle: 'general.justice.weat.media',
    description:
      'Коллективный суд из 7 случайно выбранных читателей с репутацией 1000+. Всё, что не подходит профильным коллегиям: недостоверность, плагиат, иные нарушения правил.',
    subscribers: 12840,
    labels: [
      { value: 'verdict.misleading', description: 'Содержит существенно недостоверные утверждения', defaultAction: 'warn' },
      { value: 'verdict.plagiarism', description: 'Плагиат без указания источника', defaultAction: 'hide' },
      { value: 'verdict.other', description: 'Иное нарушение правил площадки', defaultAction: 'warn' },
    ],
  },
]

export const currentUser: User = {
  name: 'Вы',
  handle: 'you.judge.dev',
  did: 'did:plc:reader001',
  premium: true,
  premiumSinceMonths: 8,
}
