/** Демо-аккаунты для тестов: pnpm seed:demo (повторный запуск ничего не ломает) */
import { loadConfig } from './config.js'
import { createDb, userRepo, type Tier } from './db.js'
import { migrate } from './migrate.js'
import { createPdsClient, PdsError } from './pds.js'

export const DEMO_PASSWORD = 'demo12345'
const DEMO: { username: string; tier: Tier; displayName: string }[] = [
  { username: 'user', tier: 'free', displayName: 'Демо-читатель' },
  { username: 'premium', tier: 'premium', displayName: 'Демо Premium' },
]

const config = loadConfig()
const sql = createDb(config.DATABASE_URL)
await migrate(sql)
const users = userRepo(sql)
const pds = createPdsClient(config.PDS_URL, config.PDS_ADMIN_PASSWORD)

for (const demo of DEMO) {
  const handle = `${demo.username}.${config.PDS_HANDLE_DOMAIN}`
  let session
  try {
    session = await pds.createSession(handle, DEMO_PASSWORD)
  } catch (err) {
    if (!(err instanceof PdsError) || err.status >= 500) throw err
    // user/premium — зарезервированные имена PDS: создаём под временным handle и переименовываем админом
    const tmp = await pds.createAccount({
      handle: `demo-${demo.username}-tmp.${config.PDS_HANDLE_DOMAIN}`,
      email: `${demo.username}@demo.indie.media`,
      password: DEMO_PASSWORD,
    })
    await pds.adminUpdateHandle(tmp.did, handle)
    session = await pds.createSession(handle, DEMO_PASSWORD)
  }
  await users.insert({ did: session.did, handle: session.handle, displayName: demo.displayName, signupCountry: 'RU' })
  await users.setTier(session.did, demo.tier)
  console.log(`${handle} / ${DEMO_PASSWORD} · ${demo.tier} · ${session.did}`)
}
await sql.end()
