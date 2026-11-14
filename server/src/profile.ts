import type { Context, Hono } from 'hono'
import { z } from 'zod'
import type { UserRepo } from './db.js'
import { PdsError, type PdsClient } from './pds.js'

/**
 * Профиль автора: имя, «О себе», аватар. Источник правды — запись app.bsky.actor.profile в репозитории
 * (её видят и Bluesky, и другие приложения AT); AppView хранит копию имени и CID аватара для выдачи.
 * Аватар — blob на PDS: PNG, JPEG или WebP до 1 МБ (как в Bluesky).
 */

export const PROFILE_COLLECTION = 'app.bsky.actor.profile'
export const AVATAR_MAX = 1_000_000

export const ProfileBody = z
  .object({
    displayName: z.string().trim().min(1).max(64).nullable().optional(),
    description: z.string().trim().max(256).nullable().optional(),
  })
  .refine((b) => b.displayName !== undefined || b.description !== undefined, 'нужно displayName или description')

const fail = (code: string, message: string, status: 400 | 401 | 413 | 415 = 400) => new PdsError(status, code, message)

/** тип по сигнатуре файла, а не по заголовку: под видом картинки не загрузить что-то другое */
export function imageType(b: Uint8Array): 'image/png' | 'image/jpeg' | 'image/webp' | null {
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png'
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg'
  if (String.fromCharCode(...b.slice(0, 4)) === 'RIFF' && String.fromCharCode(...b.slice(8, 12)) === 'WEBP') return 'image/webp'
  return null
}

export interface ProfileOps {
  update(accessJwt: string, did: string, patch: { displayName?: string | null; description?: string | null }): Promise<ProfileView>
  setAvatar(accessJwt: string, did: string, file: Uint8Array | null): Promise<ProfileView>
}

export interface ProfileView {
  did: string
  displayName: string | null
  description: string | null
  avatar: string | null
}

export function profileOps(d: { pds: PdsClient; users: UserRepo }): ProfileOps {
  const write = async (accessJwt: string, did: string, change: (r: Record<string, unknown>) => void): Promise<ProfileView> => {
    const current = (await d.pds.getRecord(did, PROFILE_COLLECTION, 'self')) ?? {}
    const next: Record<string, unknown> = { ...current, $type: PROFILE_COLLECTION }
    change(next)
    await d.pds.putRecord(accessJwt, did, PROFILE_COLLECTION, 'self', next)
    const avatar = ((next.avatar as { ref?: { $link?: string } } | undefined)?.ref?.$link as string | undefined) ?? null
    return { did, displayName: (next.displayName as string | undefined) ?? null, description: (next.description as string | undefined) ?? null, avatar }
  }
  return {
    async update(accessJwt, did, patch) {
      const v = await write(accessJwt, did, (r) => {
        for (const [k, val] of Object.entries(patch)) {
          if (val === undefined) continue
          if (val === null) delete r[k]
          else r[k] = val
        }
      })
      if (patch.displayName !== undefined) await d.users.setDisplayName(did, patch.displayName)
      return v
    },
    async setAvatar(accessJwt, did, file) {
      let blob: Record<string, unknown> | null = null
      if (file) {
        const mime = imageType(file)
        if (!mime) throw fail('UnsupportedImage', 'Нужна картинка PNG, JPEG или WebP', 415)
        if (file.byteLength > AVATAR_MAX) throw fail('ImageTooLarge', 'Фото больше 1 МБ — уменьшите его', 413)
        blob = (await d.pds.uploadBlob(accessJwt, file, mime)).blob
      }
      const v = await write(accessJwt, did, (r) => {
        if (blob) r.avatar = blob
        else delete r.avatar
      })
      await d.users.setAvatar(did, v.avatar)
      return v
    },
  }
}

/** сайт: сессией пользователя */
export function mountProfileRoutes(app: Hono, d: { pds: PdsClient; ops: ProfileOps }, h: { bearer(c: Context): string | undefined }) {
  const session = async (c: Context) => {
    const token = h.bearer(c)
    if (!token) throw fail('AuthenticationRequired', 'Нужно войти', 401)
    return { token, did: (await d.pds.getSession(token)).did }
  }

  app.patch('/me/profile', async (c) => {
    const s = await session(c)
    const b = ProfileBody.safeParse(await c.req.json().catch(() => null))
    if (!b.success) throw fail('InvalidRequest', z.prettifyError(b.error))
    return c.json(await d.ops.update(s.token, s.did, b.data))
  })

  app.post('/me/avatar', async (c) => {
    const s = await session(c)
    const file = new Uint8Array(await c.req.arrayBuffer())
    if (!file.byteLength) throw fail('InvalidRequest', 'Тело запроса — файл картинки')
    return c.json(await d.ops.setAvatar(s.token, s.did, file))
  })

  app.delete('/me/avatar', async (c) => {
    const s = await session(c)
    return c.json(await d.ops.setAvatar(s.token, s.did, null))
  })
}
