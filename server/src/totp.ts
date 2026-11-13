import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

/** RFC 6238 TOTP: SHA-1, 30 с, 6 цифр — совместим с Google Authenticator и Яндекс Ключом */
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

export function base32Encode(buf: Buffer): string {
  let bits = 0
  let value = 0
  let out = ''
  for (const byte of buf) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31]
  return out
}

export function base32Decode(s: string): Buffer {
  let bits = 0
  let value = 0
  const out: number[] = []
  for (const ch of s.replace(/=+$/, '').toUpperCase()) {
    const idx = ALPHABET.indexOf(ch)
    if (idx < 0) throw new Error('bad base32')
    value = (value << 5) | idx
    bits += 5
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255)
      bits -= 8
    }
  }
  return Buffer.from(out)
}

export function newTotpSecret(): string {
  return base32Encode(randomBytes(20))
}

export function totpCode(secret: string, counter: number): string {
  const msg = Buffer.alloc(8)
  msg.writeBigUInt64BE(BigInt(counter))
  const h = createHmac('sha1', base32Decode(secret)).update(msg).digest()
  const off = h[h.length - 1]! & 15
  const bin = ((h[off]! & 0x7f) << 24) | (h[off + 1]! << 16) | (h[off + 2]! << 8) | h[off + 3]!
  return String(bin % 1_000_000).padStart(6, '0')
}

/** шаг, которому соответствует код (±1 шаг — рассинхрон часов до 30 с); null — код неверный */
export function totpStep(secret: string, code: string, now = Date.now()): number | null {
  if (!/^\d{6}$/.test(code)) return null
  const step = Math.floor(now / 30_000)
  for (const d of [-1, 0, 1]) {
    if (timingSafeEqual(Buffer.from(totpCode(secret, step + d)), Buffer.from(code))) return step + d
  }
  return null
}

export function verifyTotp(secret: string, code: string, now = Date.now()): boolean {
  return totpStep(secret, code, now) !== null
}

export function otpauthUrl(secret: string, account: string, issuer = 'Indie.media'): string {
  const label = encodeURIComponent(`${issuer}:${account}`)
  return `otpauth://totp/${label}?${new URLSearchParams({ secret, issuer, algorithm: 'SHA1', digits: '6', period: '30' })}`
}

/** резервные коды: xxxx-xxxx, храним только sha256 */
export function newBackupCodes(n = 10): string[] {
  return Array.from({ length: n }, () => {
    const hex = randomBytes(4).toString('hex')
    return `${hex.slice(0, 4)}-${hex.slice(4)}`
  })
}

export const hashBackupCode = (code: string) =>
  createHash('sha256').update(code.trim().toLowerCase().replace(/\s+/g, '')).digest('hex')
