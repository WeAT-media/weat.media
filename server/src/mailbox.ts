import type { Context, Hono } from 'hono'
import { ImapFlow } from 'imapflow'
import { simpleParser } from 'mailparser'
import nodemailer from 'nodemailer'
import { z } from 'zod'
import { PdsError } from './pds.js'
import type { Staff, StaffRole } from './staff.js'

/**
 * Почта площадки в админке (/admin/email): ящики support@, legal@, noreply@ на своём почтовом сервере (deploy/mail).
 * AppView ходит в них по IMAP/SMTP; пароли ящиков — только в окружении AppView, в браузер не попадают.
 * Кто что видит: support@ — support и admin; legal@ и noreply@ (отказы доставки) — только admin.
 * Каждое открытие письма, отправка и скачивание вложения — в журнал сотрудников.
 */

export const MAILBOXES = ['support', 'legal', 'noreply'] as const
export type MailboxId = (typeof MAILBOXES)[number]

/** роль, нужная для ящика; admin проходит везде (requireStaff) */
const ROLE: Record<MailboxId, StaffRole> = { support: 'support', legal: 'admin', noreply: 'admin' }

export const MailSummaryDto = z.object({
  uid: z.number().int(),
  from: z.string(),
  to: z.string(),
  subject: z.string(),
  date: z.string(),
  seen: z.boolean(),
  hasAttachments: z.boolean(),
})
export type MailSummary = z.infer<typeof MailSummaryDto>

export const MailMessageDto = MailSummaryDto.extend({
  messageId: z.string().nullable(),
  replyTo: z.string().nullable(),
  /** только текст: HTML писем в админке не исполняем — из него берётся текстовая версия */
  text: z.string(),
  references: z.array(z.string()),
  attachments: z.array(z.object({ id: z.string(), filename: z.string(), contentType: z.string(), size: z.number().int() })),
})
export type MailMessage = z.infer<typeof MailMessageDto>

export const SendMailBody = z.object({
  to: z.string().email().max(320),
  subject: z.string().trim().min(1).max(300),
  text: z.string().trim().min(1).max(50_000),
  /** ответ на письмо этого ящика: тема, In-Reply-To и References берутся из него */
  replyToUid: z.number().int().positive().optional(),
})

export interface MailboxClient {
  list(box: MailboxId, opts: { limit: number; beforeUid?: number }): Promise<{ messages: MailSummary[]; nextBeforeUid: number | null }>
  /** отмечает письмо прочитанным */
  get(box: MailboxId, uid: number): Promise<MailMessage | null>
  attachment(box: MailboxId, uid: number, id: string): Promise<{ filename: string; contentType: string; content: Buffer } | null>
  send(box: MailboxId, mail: { to: string; subject: string; text: string; inReplyTo?: string; references?: string[] }): Promise<{ messageId: string }>
  /** какие ящики настроены (есть пароль) */
  configured(): MailboxId[]
}

// ── IMAP/SMTP ────────────────────────────────────────────────────────────

export function createMailboxClient(opts: {
  domain: string
  imapHost: string
  smtpHost: string
  passwords: Partial<Record<MailboxId, string>>
}): MailboxClient {
  const address = (box: MailboxId) => `${box}@${opts.domain}`
  const password = (box: MailboxId) => {
    const pw = opts.passwords[box]
    if (!pw) throw new PdsError(404, 'MailboxNotConfigured', `Ящик ${address(box)} не настроен`)
    return pw
  }

  /** одно IMAP-соединение на запрос: запросов из админки мало, держать сессии незачем */
  const withInbox = async <T>(box: MailboxId, fn: (imap: ImapFlow) => Promise<T>): Promise<T> => {
    const imap = new ImapFlow({
      host: opts.imapHost,
      port: 993,
      secure: true,
      auth: { user: address(box), pass: password(box) },
      logger: false,
      socketTimeout: 30_000,
    })
    await imap.connect().catch(() => {
      throw new PdsError(502, 'MailUnavailable', 'Почтовый сервер не отвечает')
    })
    try {
      const lock = await imap.getMailboxLock('INBOX')
      try {
        return await fn(imap)
      } finally {
        lock.release()
      }
    } finally {
      await imap.logout().catch(() => {})
    }
  }

  const addr = (a: { value?: { name?: string; address?: string }[] } | { value?: { name?: string; address?: string }[] }[] | undefined) =>
    (Array.isArray(a) ? a.flatMap((x) => x.value ?? []) : (a?.value ?? []))
      .map((v) => (v.name ? `${v.name} <${v.address ?? ''}>` : (v.address ?? '')))
      .join(', ')

  const transport = (box: MailboxId) =>
    nodemailer.createTransport({ host: opts.smtpHost, port: 465, secure: true, auth: { user: address(box), pass: password(box) } })

  return {
    configured: () => MAILBOXES.filter((b) => !!opts.passwords[b]),

    list: (box, { limit, beforeUid }) =>
      withInbox(box, async (imap) => {
        const top = beforeUid ? beforeUid - 1 : '*'
        if (top !== '*' && top < 1) return { messages: [], nextBeforeUid: null }
        // UID растут: берём последние limit до верхней границы
        const uids = ((await imap.search({ uid: `1:${top}` }, { uid: true })) || []).sort((a, b) => b - a).slice(0, limit)
        const messages: MailSummary[] = []
        if (uids.length) {
          for await (const m of imap.fetch(uids, { uid: true, envelope: true, flags: true, bodyStructure: true }, { uid: true })) {
            const e = m.envelope
            const fmt = (list?: { name?: string; address?: string }[]) => (list ?? []).map((v) => (v.name ? `${v.name} <${v.address}>` : (v.address ?? ''))).join(', ')
            messages.push({
              uid: m.uid,
              from: fmt(e?.from),
              to: fmt(e?.to),
              subject: e?.subject ?? '',
              date: new Date(e?.date ?? Date.now()).toISOString(),
              seen: m.flags?.has('\\Seen') ?? false,
              hasAttachments: JSON.stringify(m.bodyStructure ?? {}).includes('"disposition":"attachment"'),
            })
          }
        }
        messages.sort((a, b) => b.uid - a.uid)
        const last = uids[uids.length - 1]
        return { messages, nextBeforeUid: uids.length === limit && last && last > 1 ? last : null }
      }),

    get: (box, uid) =>
      withInbox(box, async (imap) => {
        const m = await imap.fetchOne(String(uid), { uid: true, source: true, flags: true }, { uid: true })
        if (!m || !m.source) return null
        await imap.messageFlagsAdd(String(uid), ['\\Seen'], { uid: true })
        const p = await simpleParser(m.source)
        const refs = p.references ? (Array.isArray(p.references) ? p.references : [p.references]) : []
        return {
          uid,
          from: addr(p.from),
          to: addr(p.to),
          subject: p.subject ?? '',
          date: (p.date ?? new Date()).toISOString(),
          seen: true,
          hasAttachments: p.attachments.length > 0,
          messageId: p.messageId ?? null,
          replyTo: p.replyTo ? addr(p.replyTo) : null,
          text: p.text ?? (typeof p.html === 'string' ? p.html.replace(/<[^>]+>/g, ' ') : ''),
          references: refs,
          attachments: p.attachments.map((a, i) => ({
            id: String(i),
            filename: a.filename ?? `attachment-${i + 1}`,
            contentType: a.contentType,
            size: a.size,
          })),
        }
      }),

    attachment: (box, uid, id) =>
      withInbox(box, async (imap) => {
        const m = await imap.fetchOne(String(uid), { uid: true, source: true }, { uid: true })
        if (!m || !m.source) return null
        const a = (await simpleParser(m.source)).attachments[Number(id)]
        return a ? { filename: a.filename ?? `attachment-${Number(id) + 1}`, contentType: a.contentType, content: a.content } : null
      }),

    async send(box, mail) {
      const info = await transport(box)
        .sendMail({
          from: `weAT.media <${address(box)}>`,
          to: mail.to,
          subject: mail.subject,
          text: mail.text,
          ...(mail.inReplyTo ? { inReplyTo: mail.inReplyTo, references: [...(mail.references ?? []), mail.inReplyTo] } : {}),
        })
        .catch(() => {
          throw new PdsError(502, 'MailUnavailable', 'Не удалось отправить письмо')
        })
      return { messageId: info.messageId }
    },
  }
}

// ── маршруты ─────────────────────────────────────────────────────────────

const fail = (code: string, message: string, status: 400 | 404 = 400) => new PdsError(status, code, message)

export function mountMailboxRoutes(
  app: Hono,
  d: { mail?: MailboxClient },
  h: {
    requireStaff(c: Context, role: StaffRole): Promise<Staff | 'break-glass'>
    audit(who: Staff | 'break-glass', action: string, target: string | null, details?: Record<string, unknown>): Promise<void>
  },
) {
  const boxOf = (c: Context): MailboxId => {
    const b = c.req.param('box')
    if (!(MAILBOXES as readonly string[]).includes(b ?? '')) throw fail('NotFound', 'Нет такого ящика', 404)
    return b as MailboxId
  }
  const client = () => {
    if (!d.mail) throw fail('MailboxNotConfigured', 'Почта не настроена', 404)
    return d.mail
  }
  const uidOf = (c: Context) => {
    const n = Number(c.req.param('uid'))
    if (!Number.isInteger(n) || n < 1) throw fail('NotFound', 'Письмо не найдено', 404)
    return n
  }
  /** сотрудник с ролью ящика; заголовок — не кэшировать: письма персональные */
  const access = async (c: Context, box: MailboxId) => {
    const staff = await h.requireStaff(c, ROLE[box])
    c.header('cache-control', 'private, no-store')
    return staff
  }

  /** ящики, доступные этому сотруднику */
  app.get('/admin/mail/boxes', async (c) => {
    const staff = await h.requireStaff(c, 'support')
    c.header('cache-control', 'private, no-store')
    const roles = staff === 'break-glass' ? new Set<StaffRole>(['admin']) : staff.roles
    const boxes = (d.mail?.configured() ?? []).filter((b) => roles.has('admin') || roles.has(ROLE[b]))
    return c.json({ boxes })
  })

  app.get('/admin/mail/:box/messages', async (c) => {
    const box = boxOf(c)
    await access(c, box)
    const before = Number(c.req.query('before'))
    const limit = Math.min(Math.max(Number(c.req.query('limit')) || 50, 1), 100)
    return c.json(await client().list(box, { limit, ...(Number.isInteger(before) && before > 1 ? { beforeUid: before } : {}) }))
  })

  app.get('/admin/mail/:box/messages/:uid', async (c) => {
    const box = boxOf(c)
    const staff = await access(c, box)
    const uid = uidOf(c)
    const m = await client().get(box, uid)
    if (!m) throw fail('NotFound', 'Письмо не найдено', 404)
    await h.audit(staff, 'mail.read', `${box}:${uid}`, { subject: m.subject.slice(0, 200) })
    return c.json(m)
  })

  app.get('/admin/mail/:box/messages/:uid/attachments/:id', async (c) => {
    const box = boxOf(c)
    const staff = await access(c, box)
    const uid = uidOf(c)
    const a = await client().attachment(box, uid, c.req.param('id'))
    if (!a) throw fail('NotFound', 'Вложение не найдено', 404)
    await h.audit(staff, 'mail.attachment', `${box}:${uid}`, { filename: a.filename })
    // только скачивание: содержимое вложения не должно исполняться на нашем домене
    c.header('content-type', 'application/octet-stream')
    c.header('content-disposition', `attachment; filename*=UTF-8''${encodeURIComponent(a.filename)}`)
    c.header('x-content-type-options', 'nosniff')
    return c.body(new Uint8Array(a.content))
  })

  app.post('/admin/mail/:box/send', async (c) => {
    const box = boxOf(c)
    const staff = await access(c, box)
    if (box === 'noreply') throw fail('Forbidden', 'С noreply@ не отвечаем: ответы туда никто не читает', 400)
    const body = SendMailBody.safeParse(await c.req.json().catch(() => null))
    if (!body.success) throw fail('InvalidRequest', z.prettifyError(body.error))
    let thread: { inReplyTo?: string; references?: string[] } = {}
    if (body.data.replyToUid) {
      const orig = await client().get(box, body.data.replyToUid)
      if (!orig) throw fail('NotFound', 'Письмо, на которое отвечаете, не найдено', 404)
      thread = orig.messageId ? { inReplyTo: orig.messageId, references: orig.references } : {}
    }
    const sent = await client().send(box, { to: body.data.to, subject: body.data.subject, text: body.data.text, ...thread })
    await h.audit(staff, body.data.replyToUid ? 'mail.reply' : 'mail.send', `${box}:${body.data.replyToUid ?? 'new'}`, {
      to: body.data.to,
      subject: body.data.subject.slice(0, 200),
    })
    return c.json(sent, 201)
  })
}
