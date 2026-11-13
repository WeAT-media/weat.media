import { isIP } from 'node:net'
import maxmind, { type CountryResponse, type Reader } from 'maxmind'

export const UNKNOWN_COUNTRY = 'ZZ'

export interface GeoLookup {
  country(ip: string): string
}

function isPrivate(ip: string): boolean {
  const v4 = ip.startsWith('::ffff:') ? ip.slice(7) : ip
  if (isIP(v4) === 4) {
    const [a = 0, b = 0] = v4.split('.').map(Number)
    return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
  }
  return ip === '::1' || ip.startsWith('fc') || ip.startsWith('fd') || ip.startsWith('fe80')
}

export async function createGeo(opts: { dbPath?: string; devCountry?: string }): Promise<GeoLookup> {
  let reader: Reader<CountryResponse> | undefined
  if (opts.dbPath) reader = await maxmind.open<CountryResponse>(opts.dbPath)
  else console.warn('GEOIP_DB_PATH not set: every public IP resolves to ZZ')

  return {
    country(ip) {
      if (isPrivate(ip)) return opts.devCountry?.toUpperCase() ?? UNKNOWN_COUNTRY
      const hit = reader?.get(ip)
      return hit?.country?.iso_code ?? hit?.registered_country?.iso_code ?? UNKNOWN_COUNTRY
    },
  }
}

/** Регистрация в РФ-контуре: только российские IP; неизвестная страна — отказ */
export function contourAllows(contour: 'global' | 'ru', country: string): boolean {
  return contour === 'global' || country === 'RU'
}
