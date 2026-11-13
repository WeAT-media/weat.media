/**
 * Условия Premium площадки. Значения — черновые, утверждает владелец площадки;
 * форк задаёт свои через переменные сборки.
 */
const env = import.meta.env

/** цена в месяц, рубли */
export const PREMIUM_PRICE_RUB = Number(env.VITE_PREMIUM_PRICE_RUB ?? 299)
/** комиссия площадки с продаж: обычно и для Premium-авторов, % */
export const SALE_FEE_PCT = 10
export const PREMIUM_SALE_FEE_PCT = Number(env.VITE_PREMIUM_SALE_FEE_PCT ?? 1)
/** вес голоса Premium-присяжного в суде (src/lib/store.tsx: myWeight) */
export const PREMIUM_VOTE_WEIGHT = 1.5
