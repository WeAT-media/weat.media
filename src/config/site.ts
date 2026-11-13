/**
 * Бренд и адреса инсталляции. Форк задаёт свои значения переменными сборки —
 * без правки кода (см. .env.example в корне).
 */
const env = import.meta.env

/** Название площадки в интерфейсе */
export const SITE_NAME: string = env.VITE_SITE_NAME || 'weAT.media'

/** Домен handle пользователей этой инсталляции: alina.<HANDLE_DOMAIN> */
export const HANDLE_DOMAIN: string = env.VITE_HANDLE_DOMAIN || 'weat.media'

/** Публичный адрес PDS инсталляции */
export const PDS_URL: string = env.VITE_PDS_URL || `https://pds.${HANDLE_DOMAIN}`

/** Публичный адрес сайта (для встраиваемого виджета и ссылок наружу) */
export const SITE_URL: string = env.VITE_SITE_URL || (typeof window !== 'undefined' ? window.location.origin : `https://${HANDLE_DOMAIN}`)

/** Репозиторий исходного кода (AGPL-3.0: ссылка на исходники обязательна для сетевого сервиса) */
export const SOURCE_URL: string = env.VITE_SOURCE_URL || 'https://github.com/WeAT-media/weat.media'
