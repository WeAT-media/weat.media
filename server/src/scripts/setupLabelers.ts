/**
 * Служебные учётки коллегий присяжных для Bluesky и всей сети AT (запуск на узле, в контейнере AppView):
 *
 *   docker compose exec -T appview node dist/scripts/setupLabelers.js accounts < state.json > state.json.new
 *   docker compose exec -T appview node dist/scripts/setupLabelers.js handles  < state.json
 *
 * accounts — для каждой коллегии: учётка <id>-justice.<домен> на PDS (почта justice-<id>@<домен> — наш ящик),
 *   отметка «служебная» в базе AppView, PLC-операция (сервис #atproto_labeler + ключ #atproto_label
 *   из сервиса коллегий; код подтверждения читаем из ящика по IMAP) и запись app.bsky.labeler.service.
 *   Вход (stdin): {"<id>": {"mailboxPassword": "…"}}; выход (stdout): то же + did и password учётки.
 * handles — после LABELER_DIDS: handle учётки → <id>.justice.<домен>. На нашем PDS не работает: handle на
 *   *.<домен> PDS считает своими, а spam/tech/… — зарезервированными. Поэтому handle коллегий — <id>-justice.<домен>,
 *   адрес сервиса — <id>.justice.<домен>; режим оставлен для коллегий на чужом PDS.
 *
 * Повторный запуск безопасен: уже созданные учётки и записи пропускаются.
 */
import { randomBytes } from 'node:crypto'
import { ImapFlow } from 'imapflow'
import postgres from 'postgres'

const env = (k: string, d?: string) => {
  const v = process.env[k] ?? d
  if (!v) throw new Error(`нет ${k}`)
  return v
}
const DOMAIN = env('PDS_HANDLE_DOMAIN', 'weat.media')
const PDS = env('PDS_URL', 'http://pds:2583')
const APPVIEW = env('APPVIEW_URL', 'http://127.0.0.1:8787')
const LABELER = env('LABELER_URL', 'http://labeler:8791')
const MAIL_HOST = env('MAIL_HOST', `mail.${DOMAIN}`)

interface Labeler { id: string; name: string; description: string; publicKeyMultibase: string; labels: { value: string; description: string; defaultAction: string }[] }
type State = Record<string, { mailboxPassword: string; password?: string; did?: string }>

const log = (...a: unknown[]) => console.error('[labelers]', ...a)

async function xrpc<T>(method: 'GET' | 'POST', nsid: string, opts: { auth?: string; body?: unknown; query?: Record<string, string> } = {}): Promise<T> {
  const url = new URL(`/xrpc/${nsid}`, PDS)
  if (opts.query) url.search = new URLSearchParams(opts.query).toString()
  const res = await fetch(url, {
    method,
    headers: { ...(opts.body ? { 'content-type': 'application/json' } : {}), ...(opts.auth ? { authorization: `Bearer ${opts.auth}` } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  })
  const data = (await res.json().catch(() => ({}))) as T & { error?: string; message?: string }
  if (!res.ok) throw new Error(`${nsid}: ${res.status} ${data.error ?? ''} ${data.message ?? ''}`)
  return data
}

/** код PLC из письма PDS: ждём новое письмо в ящике коллегии, берём XXXXX-XXXXX */
async function plcToken(user: string, pass: string, since: Date): Promise<string> {
  for (let attempt = 0; attempt < 30; attempt++) {
    const imap = new ImapFlow({ host: MAIL_HOST, port: 993, secure: true, auth: { user, pass }, logger: false })
    await imap.connect()
    try {
      const lock = await imap.getMailboxLock('INBOX')
      try {
        const uids = (await imap.search({ since }, { uid: true })) || []
        for (const uid of uids.sort((a, b) => b - a)) {
          const m = await imap.fetchOne(String(uid), { source: true }, { uid: true })
          const text = m && m.source ? m.source.toString('utf8') : ''
          const code = text.match(/\b([A-Z2-7]{5}-[A-Z2-7]{5})\b/)?.[1]
          if (code) return code
        }
      } finally {
        lock.release()
      }
    } finally {
      await imap.logout().catch(() => {})
    }
    await new Promise((r) => setTimeout(r, 3000))
  }
  throw new Error(`${user}: письмо с кодом PLC не пришло за 90 с`)
}

const severity = (a: string) => (a === 'hide' ? 'alert' : 'inform')

async function accounts(state: State) {
  const { labelers } = (await (await fetch(`${LABELER}/xrpc/app.weat.labeler.describe`)).json()) as { labelers: Labeler[] }
  const sql = postgres(env('DATABASE_URL'), { max: 1, onnotice: () => {} })
  try {
    for (const l of labelers) {
      const st = state[l.id]
      if (!st?.mailboxPassword) {
        log(l.id, 'нет mailboxPassword — пропуск')
        continue
      }
      const email = `justice-${l.id}@${DOMAIN}`
      const handle = `${l.id}-justice.${DOMAIN}`
      if (!st.did) {
        st.password = randomBytes(24).toString('base64url')
        const res = await fetch(`${APPVIEW}/api/auth/register`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ username: `${l.id}-justice`, email, password: st.password, consent: { personalData: true, terms: true } }),
        })
        const body = (await res.json()) as { accessJwt?: string; user?: { did: string }; message?: string }
        if (!res.ok || !body.user) throw new Error(`${l.id}: регистрация — ${res.status} ${body.message ?? ''}`)
        st.did = body.user.did
        log(l.id, 'учётка создана', st.did)
      }
      const session = await xrpc<{ did: string; accessJwt: string }>('POST', 'com.atproto.server.createSession', { body: { identifier: st.did, password: st.password } })
      await sql`UPDATE users SET service = 'labeler', display_name = ${l.name} WHERE did = ${session.did}`

      // DID-документ: сервис лейблера и ключ подписи меток
      const doc = (await (await fetch(`https://plc.directory/${session.did}`)).json()) as { service?: { id: string }[] }
      const ready = doc.service?.some((x) => x.id === '#atproto_labeler')
      if (!ready) {
        const since = new Date(Date.now() - 60_000)
        await xrpc('POST', 'com.atproto.identity.requestPlcOperationSignature', { auth: session.accessJwt })
        const token = await plcToken(email, st.mailboxPassword, since)
        const creds = await xrpc<{ rotationKeys: string[]; alsoKnownAs: string[]; verificationMethods: Record<string, string>; services: Record<string, unknown> }>(
          'GET', 'com.atproto.identity.getRecommendedDidCredentials', { auth: session.accessJwt },
        )
        const { operation } = await xrpc<{ operation: unknown }>('POST', 'com.atproto.identity.signPlcOperation', {
          auth: session.accessJwt,
          body: {
            token,
            rotationKeys: creds.rotationKeys,
            alsoKnownAs: creds.alsoKnownAs,
            verificationMethods: { ...creds.verificationMethods, atproto_label: `did:key:${l.publicKeyMultibase}` },
            services: { ...creds.services, atproto_labeler: { type: 'AtprotoLabeler', endpoint: `https://${l.id}.justice.${DOMAIN}` } },
          },
        })
        await xrpc('POST', 'com.atproto.identity.submitPlcOperation', { auth: session.accessJwt, body: { operation } })
        log(l.id, 'DID: сервис лейблера и ключ добавлены')
      }

      // объявление лейблера: какие метки он выдаёт и как их показывать по умолчанию
      await xrpc('POST', 'com.atproto.repo.putRecord', {
        auth: session.accessJwt,
        body: {
          repo: session.did,
          collection: 'app.bsky.labeler.service',
          rkey: 'self',
          record: {
            $type: 'app.bsky.labeler.service',
            createdAt: new Date().toISOString(),
            policies: {
              labelValues: l.labels.map((v) => v.value),
              labelValueDefinitions: l.labels.map((v) => ({
                identifier: v.value,
                severity: severity(v.defaultAction),
                blurs: v.defaultAction === 'hide' ? 'content' : 'none',
                defaultSetting: v.defaultAction === 'ignore' ? 'ignore' : v.defaultAction,
                adultOnly: false,
                locales: [{ lang: 'ru', name: v.description.slice(0, 64), description: `${l.name}: ${v.description}` }],
              })),
            },
          },
        },
      })
      await xrpc('POST', 'com.atproto.repo.putRecord', {
        auth: session.accessJwt,
        body: { repo: session.did, collection: 'app.bsky.actor.profile', rkey: 'self', record: { $type: 'app.bsky.actor.profile', displayName: l.name, description: `${l.description}\n\nКоллегия присяжных ${DOMAIN}.` } },
      })
      log(l.id, 'app.bsky.labeler.service опубликован', handle)
    }
  } finally {
    await sql.end()
  }
  return state
}

async function handles(state: State) {
  const sql = postgres(env('DATABASE_URL'), { max: 1, onnotice: () => {} })
  try {
    for (const [id, st] of Object.entries(state)) {
      if (!st.did || !st.password) continue
      const target = `${id}.justice.${DOMAIN}`
      const resolved = (await (await fetch(`https://${target}/.well-known/atproto-did`)).text()).trim()
      if (resolved !== st.did) {
        log(id, `пропуск: ${target} указывает на ${resolved}, ждём ${st.did} (задан ли LABELER_DIDS?)`)
        continue
      }
      const s = await xrpc<{ accessJwt: string }>('POST', 'com.atproto.server.createSession', { body: { identifier: st.did, password: st.password } })
      await xrpc('POST', 'com.atproto.identity.updateHandle', { auth: s.accessJwt, body: { handle: target } })
      await sql`UPDATE users SET handle = ${target} WHERE did = ${st.did}`
      log(id, 'handle →', target)
    }
  } finally {
    await sql.end()
  }
}

const chunks: Buffer[] = []
for await (const c of process.stdin) chunks.push(c as Buffer)
const state = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as State
const mode = process.argv[2]
if (mode === 'accounts') process.stdout.write(JSON.stringify(await accounts(state), null, 2))
else if (mode === 'handles') await handles(state)
else {
  console.error('режим: accounts | handles')
  process.exit(1)
}
