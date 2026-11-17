import { serve } from '@hono/node-server'
import { getConnInfo } from '@hono/node-server/conninfo'
import { createApp } from './app.js'
import { loadConfig } from './config.js'
import { createDb, identityRepo, mfaRepo, userRepo } from './db.js'
import { createSecretBox } from './secretbox.js'
import { createOAuthClient } from './providers.js'
import { createAtprotoAuth } from './atprotoOAuth.js'
import { createGeo } from './geo.js'
import { createPeer } from './contour.js'
import { migrate } from './migrate.js'
import { createPdsClient } from './pds.js'
import { settingsRepo } from './settings.js'
import { paidRepo } from './paidContent.js'
import { developerRepo } from './developer.js'
import { createLavaClient, orderRepo, premiumOrderRepo } from './lava.js'
import { auditRepo, createStaffVerifier } from './staff.js'
import { claimRepo } from './claims.js'
import { ticketRepo } from './tickets.js'
import { sessionRepo } from './sessions.js'
import { importRepo } from './imports.js'
import { createMailboxClient } from './mailbox.js'
import { payoutRepo } from './payouts.js'
import { systemAccountRepo } from './systemAccounts.js'
import { draftRepo } from './drafts.js'
import { sharedRepo } from './shared.js'
import { cooldownRepo, createCooldown } from './cooldown.js'
import { notificationRepo, notificationService } from './notifications.js'

const config = loadConfig()
const sql = createDb(config.DATABASE_URL)
await migrate(sql, { standby: config.NODE_ROLE === 'standby' })

const pds = createPdsClient(config.PDS_URL, config.PDS_ADMIN_PASSWORD)
const secrets = createSecretBox(config.SECRETS_KEY)
const premiumOrders = premiumOrderRepo(sql)
const cooldown = createCooldown({ pds, secrets, repo: cooldownRepo(sql) })
// созревшие записи уходят в AT раз в минуту — только с основного узла (на standby — та же база по репликации)
if (config.NODE_ROLE === 'primary') {
  setInterval(() => {
    cooldown.publishDue().then((n) => n && console.log(`cooldown: published ${n}`), (e) => console.error('cooldown', e))
  }, 60_000).unref()
  // оплаченный срок Premium истёк — снова free
  const users = userRepo(sql)
  setInterval(() => {
    premiumOrders.expired().then(
      async (dids) => { for (const did of dids) await users.setTier(did, 'free'); if (dids.length) console.log(`premium: expired ${dids.length}`) },
      (e) => console.error('premium expiry', e),
    )
  }, 600_000).unref()
}

const app = createApp({
  cooldown,
  config,
  users: userRepo(sql),
  settings: settingsRepo(sql),
  notifications: notificationService(notificationRepo(sql), settingsRepo(sql)),
  identities: identityRepo(sql),
  mfa: mfaRepo(sql),
  paid: paidRepo(sql),
  developer: developerRepo(sql),
  orders: orderRepo(sql),
  premiumOrders,
  claims: claimRepo(sql),
  tickets: ticketRepo(sql),
  sessions: sessionRepo(sql),
  imports: importRepo(sql),
  payouts: payoutRepo(sql),
  system: systemAccountRepo(sql),
  drafts: draftRepo(sql),
  shared: sharedRepo(sql),
  mail: createMailboxClient({
    domain: config.MAIL_DOMAIN,
    imapHost: config.MAIL_HOST,
    smtpHost: config.MAIL_HOST,
    passwords: { support: config.MAILBOX_SUPPORT_PASSWORD, legal: config.MAILBOX_LEGAL_PASSWORD, noreply: config.MAILBOX_NOREPLY_PASSWORD },
  }),
  feedUrl: config.FEED_URL,
  labelerUrl: config.LABELER_URL,
  labelerToken: config.LABELER_ADMIN_TOKEN,
  staff:
    config.ZITADEL_ISSUER && config.ZITADEL_PROJECT_ID
      ? createStaffVerifier({ issuer: config.ZITADEL_ISSUER, projectId: config.ZITADEL_PROJECT_ID, jwksUrl: config.ZITADEL_JWKS_URL })
      : undefined,
  audit: auditRepo(sql),
  lava: config.LAVA_API_KEY ? createLavaClient(config.LAVA_API_KEY, config.LAVA_API_URL) : undefined,
  paidBox: createSecretBox(config.PAID_CONTENT_KEY ?? config.SECRETS_KEY),
  secrets,
  oauth: Object.fromEntries(
    (
      [
        ['yandex', config.YANDEX_CLIENT_ID, config.YANDEX_CLIENT_SECRET],
        ['google', config.GOOGLE_CLIENT_ID, config.GOOGLE_CLIENT_SECRET],
        ['github', config.GITHUB_CLIENT_ID, config.GITHUB_CLIENT_SECRET],
        ['telegram', config.TELEGRAM_CLIENT_ID, config.TELEGRAM_CLIENT_SECRET],
      ] as const
    )
      .filter(([, id, secret]) => id && secret)
      .map(([p, id, secret]) => [p, createOAuthClient(p, { clientId: id!, clientSecret: secret!, baseUrl: config.OAUTH_STUB_URL })]),
  ),
  atproto: config.ATPROTO_OAUTH
    ? createAtprotoAuth({
        publicUrl: config.PUBLIC_URL,
        plcDirectoryUrl: config.ATPROTO_PLC_URL,
        handleResolver: config.ATPROTO_HANDLE_RESOLVER,
        allowHttp: config.ATPROTO_ALLOW_HTTP,
      })
    : undefined,
  pds,
  pdsUrl: config.PDS_URL,
  peer: config.PEER_CONTOUR_URL ? createPeer(config.PEER_CONTOUR_URL, 3000, config.PEER_SECRET) : undefined,
  nodeRole: config.NODE_ROLE,
  geo: await createGeo({ dbPath: config.GEOIP_DB_PATH, devCountry: config.GEOIP_DEV_COUNTRY }),
  socketIp: (c) => getConnInfo(c).remote.address ?? '',
})

serve({ fetch: app.fetch, port: config.PORT }, (info) => {
  console.log(`appview listening on :${info.port} (contour=${config.CONTOUR})`)
})
