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
import { createLavaClient, orderRepo } from './lava.js'
import { auditRepo, createStaffVerifier } from './staff.js'
import { claimRepo } from './claims.js'
import { ticketRepo } from './tickets.js'
import { sessionRepo } from './sessions.js'
import { importRepo } from './imports.js'
import { createMailboxClient } from './mailbox.js'
import { payoutRepo } from './payouts.js'

const config = loadConfig()
const sql = createDb(config.DATABASE_URL)
await migrate(sql)

const app = createApp({
  config,
  users: userRepo(sql),
  settings: settingsRepo(sql),
  identities: identityRepo(sql),
  mfa: mfaRepo(sql),
  paid: paidRepo(sql),
  developer: developerRepo(sql),
  orders: orderRepo(sql),
  claims: claimRepo(sql),
  tickets: ticketRepo(sql),
  sessions: sessionRepo(sql),
  imports: importRepo(sql),
  payouts: payoutRepo(sql),
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
  secrets: createSecretBox(config.SECRETS_KEY),
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
  pds: createPdsClient(config.PDS_URL, config.PDS_ADMIN_PASSWORD),
  peer: config.PEER_CONTOUR_URL ? createPeer(config.PEER_CONTOUR_URL) : undefined,
  nodeRole: config.NODE_ROLE,
  geo: await createGeo({ dbPath: config.GEOIP_DB_PATH, devCountry: config.GEOIP_DEV_COUNTRY }),
  socketIp: (c) => getConnInfo(c).remote.address ?? '',
})

serve({ fetch: app.fetch, port: config.PORT }, (info) => {
  console.log(`appview listening on :${info.port} (contour=${config.CONTOUR})`)
})
