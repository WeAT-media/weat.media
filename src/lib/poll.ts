/** Модель опроса: общая для блока редактора (customBlocks) и опубликованной статьи (Poll) */

export const POLL_DURATIONS = [1, 3, 6, 12, 24, 36, 48, 72] as const
export type PollDuration = (typeof POLL_DURATIONS)[number]

export interface PollSettings {
  /** несколько вариантов за один голос */
  multiple: boolean
  /** варианты в случайном порядке (у каждого читателя свой, стабильный) */
  shuffle: boolean
  /** голосуют только подписчики автора */
  subscribersOnly: boolean
  /** голосуют только вошедшие пользователи */
  authorizedOnly: boolean
  /** ISO 3166-1 alpha-2; пусто — без ограничения */
  countries: string[]
  /** длительность от публикации; null — без срока */
  durationHours: PollDuration | null
  /** анонимный: никто, включая автора, не видит, кто как голосовал */
  anonymous: boolean
  /** неанонимный: список участников виден сразу или только после завершения */
  showVoters: 'always' | 'afterClose'
  /** можно отозвать голос и проголосовать заново, пока опрос открыт */
  allowRetract: boolean
  /** результаты видны после своего голоса или только после завершения */
  showResults: 'afterVote' | 'afterClose'
}

export interface PollData {
  question: string
  options: string[]
  settings: PollSettings
}

export const DEFAULT_POLL_SETTINGS: PollSettings = {
  multiple: false,
  shuffle: false,
  subscribersOnly: false,
  authorizedOnly: false,
  countries: [],
  durationHours: null,
  anonymous: true,
  showVoters: 'afterClose',
  allowRetract: false,
  showResults: 'afterVote',
}

export interface ParsedPoll extends PollData {
  /** ISO-время начала голосования, проставляется при публикации */
  startsAt?: string
  /** старый формат: «стаж: 5» — только Premium со стажем от N месяцев */
  minPremiumMonths: number
}

const normCountries = (v: unknown): string[] =>
  Array.isArray(v)
    ? [...new Set(v.map((c) => String(c).trim().toUpperCase()).filter((c) => /^[A-Z]{2}$/.test(c)))]
    : []

const normDuration = (v: unknown): PollDuration | null => {
  const n = typeof v === 'string' ? parseInt(v, 10) : v
  return (POLL_DURATIONS as readonly number[]).includes(n as number) ? (n as PollDuration) : null
}

export function normalizePoll(raw: Partial<Omit<PollData, "settings">> & { settings?: Partial<PollSettings> }): PollData {
  const s: Partial<PollSettings> = raw.settings ?? {}
  return {
    question: raw.question ?? '',
    options: Array.isArray(raw.options) ? raw.options.map(String) : [],
    settings: {
      multiple: !!s.multiple,
      shuffle: !!s.shuffle,
      subscribersOnly: !!s.subscribersOnly,
      authorizedOnly: !!s.authorizedOnly,
      countries: normCountries(s.countries),
      durationHours: normDuration(s.durationHours),
      // по умолчанию анонимный: старые опросы без поля тоже анонимны
      anonymous: s.anonymous !== false,
      showVoters: s.showVoters === 'always' ? 'always' : 'afterClose',
      allowRetract: !!s.allowRetract,
      showResults: s.showResults === 'afterClose' ? 'afterClose' : 'afterVote',
    },
  }
}

/** JSON из редактора или старый текстовый формат (вопрос, «- вариант», «ключ: значение») */
export function parsePoll(text: string): ParsedPoll {
  const t = text.trim()
  if (t.startsWith('{')) {
    try {
      const json = JSON.parse(t) as Parameters<typeof normalizePoll>[0] & { startsAt?: unknown }
      const startsAt = typeof json.startsAt === 'string' ? json.startsAt : undefined
      return { ...normalizePoll(json), minPremiumMonths: 0, ...(startsAt ? { startsAt } : {}) }
    } catch {
      /* битый JSON — разбираем как текст */
    }
  }
  const options: string[] = []
  const kv: Record<string, string> = {}
  let question = 'Опрос'
  for (const line of t.split(/\\n|\n/)) {
    if (line.startsWith('- ')) options.push(line.slice(2))
    else if (line.includes(':')) {
      const [k = '', ...rest] = line.split(':')
      kv[k.trim().toLowerCase()] = rest.join(':').trim()
    } else if (line.trim()) question = line.trim()
  }
  const geo = kv['geo'] && kv['geo'] !== 'все' ? kv['geo'].split(/[,\s]+/) : []
  return {
    question,
    options,
    settings: {
      ...DEFAULT_POLL_SETTINGS,
      subscribersOnly: kv['подписчики'] === 'да',
      countries: normCountries(geo),
      durationHours: normDuration(kv['срок']),
    },
    minPremiumMonths: kv['стаж'] ? parseInt(kv['стаж'], 10) || 0 : 0,
  }
}

/** Стабильная перестановка для читателя: один и тот же порядок при каждом заходе */
export function shuffledOrder(n: number, seed: string): number[] {
  let h = 2166136261
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619)
  const order = Array.from({ length: n }, (_, i) => i)
  for (let i = n - 1; i > 0; i--) {
    h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0
    const j = h % (i + 1)
    ;[order[i], order[j]] = [order[j]!, order[i]!]
  }
  return order
}

export const durationLabel = (h: PollDuration) => (h < 24 ? `${h} ч` : h % 24 === 0 ? `${h / 24} дн` : `${h} ч`)

/** Ключ голоса: статья + порядковый номер опроса в ней (в статье может быть несколько опросов) */
export const pollKey = (articleId: string, index: number) => `${articleId}#${index}`

/** Детерминированные мок-голоса прототипа (реальные голоса — в AppView) */
export function baseCounts(seed: string, count: number): number[] {
  let h = 0
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) % 997
  return Array.from({ length: count }, (_, i) => 3 + ((h * (i + 3) * 7) % 41))
}

const VOTER_POOL = [
  'alina-v.bsky.social', 'marat-g.dev', 'loschin.io', 'nadia-k.weat.media', 'egor.weat.media', 'olga-p.bsky.social',
  'timur.dev', 'vera.weat.media', 'sasha-m.bsky.social', 'kirill.weat.media', 'dina.dev', 'roman-z.bsky.social',
]

/** Мок-участники по варианту: стабильные handle для неанонимных опросов */
export function mockVoters(seed: string, option: number, count: number): string[] {
  const start = (seed.length * 7 + option * 5) % VOTER_POOL.length
  return Array.from({ length: Math.min(count, VOTER_POOL.length) }, (_, i) => VOTER_POOL[(start + i) % VOTER_POOL.length]!)
}

export interface PollTally {
  counts: number[]
  /** участники по вариантам: реальные голоса (новые сверху) + мок прототипа */
  voters: string[][]
  totalVotes: number
  /** число проголосовавших (в опросе с несколькими ответами ≠ сумме голосов) */
  participants: number
}

/** Голос хранится по пользователю: «articleId#index@handle»; гость — @guest */
export const voteKey = (key: string, handle: string | undefined) => `${key}@${handle ?? 'guest'}`

/** Все реальные голоса опроса: handle -> выбранные варианты */
export function pollBallots(votes: Record<string, number | number[]>, key: string): [string, number[]][] {
  const prefix = `${key}@`
  return Object.entries(votes)
    .filter(([k]) => k.startsWith(prefix))
    .map(([k, v]) => [k.slice(prefix.length), Array.isArray(v) ? v : [v]] as [string, number[]])
}

export function tallyPoll(votes: Record<string, number | number[]>, key: string, optionCount: number): PollTally {
  const base = baseCounts(key, optionCount)
  const ballots = pollBallots(votes, key)
  const real = (i: number) => ballots.filter(([, v]) => v.includes(i)).map(([h]) => h)
  const counts = base.map((n, i) => n + real(i).length)
  const voters = base.map((n, i) => [...real(i).filter((h) => h !== 'guest'), ...mockVoters(key, i, n)])
  const participants = Math.max(...base, 0) + base.length * 2 + ballots.length
  return { counts, voters, totalVotes: counts.reduce((a, b) => a + b, 0), participants }
}

/** Мой голос: новый ключ по пользователю; старые данные (без пользователя) — только у первого опроса */
export function readVote(
  votes: Record<string, number | number[]>,
  articleId: string,
  index: number,
  handle: string | undefined,
): number[] | undefined {
  const v = votes[voteKey(pollKey(articleId, index), handle)] ?? (index === 0 ? votes[articleId] : undefined)
  return v === undefined ? undefined : Array.isArray(v) ? v : [v]
}
