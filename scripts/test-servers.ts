import { LOOPBACK, seedAppDatabase, startApp } from './app-server.ts'
import type { AppSeed, RunningApp } from './app-server.ts'
import { dropTestDatabase, testDatabaseUrl } from './test-db.ts'

type User = RunningApp['user']

export type TestServers = {
  appUrl: string
  closedAppUrl: string
  databaseUrl: string
  env: Record<string, string>
  mailpitUrl: string
  otherUser: User
  user: User
}

type StartedTestServers = { servers: TestServers; stop: () => Promise<void> }

type Mail = { api: string; settings: { MAIL_FROM: string; SMTP_URL: string } }

type ServerSpec = {
  databaseUrl: string
  mail: Mail
  runner: 'integration' | 'e2e'
  seed: AppSeed
}

const mailpit = async (): Promise<Mail> => {
  const host = process.env.MAILPIT_HOST || '127.0.0.1'
  const api = `http://${host}:${process.env.MAILPIT_HTTP_PORT || '54380'}`
  const ready = await fetch(`${api}/readyz`).catch(() => undefined)
  if (!ready?.ok) {
    throw new Error(
      `Mailpit is not reachable at ${api}/readyz (${ready ? `status ${ready.status}` : 'no answer'}; expected 200). ` +
        'Start it with `pnpm mail:up`.',
    )
  }
  const smtp = `smtp://${host}:${process.env.MAILPIT_SMTP_PORT || '54325'}`
  return { api, settings: { MAIL_FROM: 'App <no-reply@example.test>', SMTP_URL: smtp } }
}

const SERVER_SETTINGS = ['DATABASE_URL', 'APP_URL', 'BETTER_AUTH_SECRET', 'AUTH_SIGN_UP', 'SMTP_URL', 'MAIL_FROM']

const startOpenServer = ({ databaseUrl, mail, runner, seed }: ServerSpec) =>
  startApp({
    databaseUrl,
    edge:
      process.env.TEST_EDGE === '1'
        ? { logFile: `test-results/edge-${runner}.log`, trustedProxies: 'private_ranges' }
        : undefined,
    logFile: `test-results/app-server-${runner}.log`,
    seed,
    settings: { AUTH_SIGN_UP: 'open', ...mail.settings },
    trustedProxies: LOOPBACK,
  })

const startClosedServer = ({ databaseUrl, mail, runner, seed }: ServerSpec) =>
  startApp({
    databaseUrl,
    logFile: `test-results/app-server-${runner}-closed.log`,
    seed,
    settings: { AUTH_SIGN_UP: 'closed', ...mail.settings },
    trustedProxies: '10.0.0.0/8',
  })

const handOver = (open: RunningApp, closed: RunningApp, mail: Mail): TestServers => ({
  appUrl: open.url,
  closedAppUrl: closed.url,
  databaseUrl: open.databaseUrl,
  env: Object.fromEntries(SERVER_SETTINGS.map((name) => [name, open.env[name] ?? ''])),
  mailpitUrl: mail.api,
  otherUser: open.otherUser,
  user: open.user,
})

const stopAll = (running: ReadonlyArray<RunningApp>, databaseUrl: string) => async () => {
  await Promise.all(running.map((app) => app.stop()))
  if (process.env.KEEP_TEST_DB !== '1') {
    await dropTestDatabase(databaseUrl)
  }
}

const track = (started: Promise<RunningApp>, running: Array<RunningApp>) =>
  started.then((app) => {
    running.push(app)
    return app
  })

const startPair = async (spec: ServerSpec, running: Array<RunningApp>): Promise<[RunningApp, RunningApp]> => {
  const open = track(startOpenServer(spec), running)
  const closed = track(startClosedServer(spec), running)
  try {
    return await Promise.all([open, closed])
  } catch (error) {
    await Promise.allSettled([open, closed])
    throw error
  }
}

export const startTestServers = async (runner: 'integration' | 'e2e'): Promise<StartedTestServers> => {
  const mail = await mailpit()
  const databaseUrl = testDatabaseUrl(runner)
  const running: Array<RunningApp> = []
  const stop = stopAll(running, databaseUrl)
  try {
    const seed = await seedAppDatabase(databaseUrl, { seedUsers: runner === 'e2e' ? 'none' : 'all' })
    const [open, closed] = await startPair({ databaseUrl, mail, runner, seed }, running)
    return { servers: handOver(open, closed, mail), stop }
  } catch (error) {
    await stop()
    throw error
  }
}
