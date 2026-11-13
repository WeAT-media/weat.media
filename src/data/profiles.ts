/** Моковые метаданные публичных профилей (bio, дата регистрации, счётчики) */
export interface ProfileMeta {
  handle: string
  bio: string
  joinedAt: string
  followers: number
  following: number
  premium?: boolean
  isCrawler?: boolean
}

export const profileMetaSeed: ProfileMeta[] = [
  {
    handle: 'marat-g.dev',
    bio: 'Инженер инфраструктуры. Пишу о Rust, firehose и о том, как не уронить AppView в проде.',
    joinedAt: '2025-03-14',
    followers: 3180,
    following: 142,
  },
  {
    handle: 'alina-v.bsky.social',
    bio: 'Объясняю AT Protocol на пальцах. Серия «AT Protocol с нуля» и живые разборы firehose.',
    joinedAt: '2025-01-30',
    followers: 5412,
    following: 98,
    premium: true,
  },
  {
    handle: 'loschin.io',
    bio: 'CTO небольшого прода. Год пишем код с LLM и честно публикуем, что из этого вышло.',
    joinedAt: '2025-06-02',
    followers: 2041,
    following: 210,
  },
  {
    handle: 'givi-hype.blog',
    bio: 'Громкие тезисы о разработке. Иногда коллегия присяжных со мной не согласна — апелляции подаю регулярно.',
    joinedAt: '2025-09-19',
    followers: 866,
    following: 54,
  },
  {
    handle: 'sofya-c.io',
    bio: 'Платёжные системы и миграции без даунтайма. Автор курса «Проектируем AppView, который не падает».',
    joinedAt: '2025-02-11',
    followers: 4230,
    following: 121,
    premium: true,
  },
  {
    handle: 'crawler.habr.dev',
    bio: 'Автоматический импорт новостей с Habr. Оригинальный автор может оформить передачу прав в один клик.',
    joinedAt: '2025-05-01',
    followers: 1540,
    following: 0,
    isCrawler: true,
  },
  {
    handle: 'crawler.vc.dev',
    bio: 'Автоматический импорт новостей с vc.ru. Первоисточник указывается всегда, права передаются по запросу.',
    joinedAt: '2025-05-01',
    followers: 980,
    following: 0,
    isCrawler: true,
  },
  {
    handle: 'you.judge.dev',
    bio: 'Демо-пользователь прототипа. Читатель, присяжный и немного автор.',
    joinedAt: '2026-01-15',
    followers: 3,
    following: 2,
  },
]
