import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

/** AES-256-GCM: "v1.<iv>.<tag>.<ciphertext>" в base64url */
export interface SecretBox {
  seal(plain: string): string
  open(sealed: string): string
}

export function createSecretBox(hexKey: string): SecretBox {
  const key = Buffer.from(hexKey, 'hex')
  if (key.length !== 32) throw new Error('SECRETS_KEY must be 32 bytes hex (openssl rand -hex 32)')
  return {
    seal(plain) {
      const iv = randomBytes(12)
      const c = createCipheriv('aes-256-gcm', key, iv)
      const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()])
      return ['v1', iv, c.getAuthTag(), ct].map((p) => (typeof p === 'string' ? p : p.toString('base64url'))).join('.')
    },
    open(sealed) {
      const [v, iv, tag, ct] = sealed.split('.')
      if (v !== 'v1' || !iv || !tag || !ct) throw new Error('bad sealed value')
      const d = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'))
      d.setAuthTag(Buffer.from(tag, 'base64url'))
      return Buffer.concat([d.update(Buffer.from(ct, 'base64url')), d.final()]).toString('utf8')
    },
  }
}
