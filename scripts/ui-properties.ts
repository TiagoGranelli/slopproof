// Runs Bombadil property-based browser testing against the built app (public and signed-in sessions).
// Starts the built app via scripts/app-server.ts on a throwaway Postgres database, launches Playwright's
// headless Chromium with remote debugging, runs `bombadil browser test-external`, and asserts zero 5xx logs.
// Usage: pnpm build && pnpm verify:ui-properties
import { type ChildProcess, spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createServer } from 'node:net'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { xSync } from 'tinyexec'
import { LOOPBACK, type RunningApp, startApp } from './app-server.ts'
import { dropTestDatabase, testDatabaseUrl } from './test-db.ts'

const TIME_LIMIT = process.env.BOMBADIL_TIME_LIMIT || '15s'
const SPEC_FILE = 'tests/bombadil/app.ts'
const OUTPUT_ROOT = 'test-results/bombadil'
const LOG_FILE = 'test-results/app-server-bombadil.log'
// Short path under ~/.cache so Chromium's SingletonSocket stays under Linux's 108-byte sun_path limit.
const CHROME_CACHE_DIR = join(homedir(), '.cache', 'b-cdp')

interface BrowserHandle {
  readonly debuggerUrl: string
  readonly stop: () => Promise<void>
}

interface PassOptions {
  readonly cookies?: ReadonlyArray<string>
  readonly debuggerUrl: string
  readonly name: string
  readonly originUrl: string
}

interface PassOutcome {
  readonly durationSeconds: string
  readonly name: string
  readonly ok: boolean
}

const freePort = (): Promise<number> =>
  new Promise((resolve, reject) => {
    const probe = createServer().once('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address() as { port: number }
      probe.close(() => resolve(address.port))
    })
  })

const waitForDebugger = async (debuggerUrl: string, child: ChildProcess): Promise<void> => {
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Headless Chromium exited early (code ${child.exitCode})`)
    }
    const response = await fetch(`${debuggerUrl}/json/version`).catch(() => undefined)
    if (response?.ok) {
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`Timed out waiting for Chromium remote debugger at ${debuggerUrl}`)
}

const chromeArgs = (port: number, userDataDir: string): Array<string> => [
  '--headless=new',
  '--no-sandbox',
  '--disable-gpu',
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${userDataDir}`,
  'about:blank',
]

const stopChrome = (child: ChildProcess, userDataDir: string) => async (): Promise<void> => {
  child.kill('SIGTERM')
  await new Promise((resolve) => child.once('exit', resolve))
  rmSync(userDataDir, { force: true, recursive: true })
}

const startHeadlessChrome = async (): Promise<BrowserHandle> => {
  const executablePath = process.env.CHROME_PATH || chromium.executablePath()
  const port = await freePort()
  mkdirSync(CHROME_CACHE_DIR, { recursive: true })
  const userDataDir = mkdtempSync(join(CHROME_CACHE_DIR, 'p-'))
  const child = spawn(executablePath, chromeArgs(port, userDataDir), {
    env: { ...process.env, TMPDIR: CHROME_CACHE_DIR },
    stdio: 'ignore',
  })
  const debuggerUrl = `http://127.0.0.1:${port}`
  await waitForDebugger(debuggerUrl, child)
  return { debuggerUrl, stop: stopChrome(child, userDataDir) }
}

const signInCookies = async (app: RunningApp): Promise<Array<string>> => {
  const response = await fetch(`${app.url}/api/auth/sign-in/email`, {
    body: JSON.stringify({ email: app.user.email, password: app.user.password }),
    headers: { 'content-type': 'application/json', origin: app.url, 'x-forwarded-for': '198.51.100.10' },
    method: 'POST',
  })
  if (!response.ok) {
    throw new Error(`Failed to sign in seed author for Bombadil (status ${response.status})`)
  }
  return response.headers.getSetCookie().map((cookie) => cookie.split(';', 1)[0] ?? '')
}

const seedPosts = async (app: RunningApp, cookies: ReadonlyArray<string>): Promise<void> => {
  const cookieHeader = cookies.join('; ')
  for (let index = 1; index <= 12; index++) {
    const response = await fetch(`${app.url}/api/me/posts`, {
      body: JSON.stringify({ body: `Seeded post #${index} for property exploration` }),
      headers: {
        'content-type': 'application/json',
        cookie: cookieHeader,
        origin: app.url,
        'x-forwarded-for': '198.51.100.11',
      },
      method: 'POST',
    })
    if (!response.ok) {
      throw new Error(`Failed to seed post #${index} (status ${response.status})`)
    }
  }
}

const bombadilArgs = (options: PassOptions): Array<string> => [
  'browser',
  'test-external',
  '--remote-debugger',
  options.debuggerUrl,
  '--create-target',
  '--instrument-javascript',
  '',
  '--time-limit',
  TIME_LIMIT,
  '--exit-on-violation',
  '--output-path',
  join(OUTPUT_ROOT, options.name),
  '--output-path-overwrite',
  ...(options.cookies ?? []).flatMap((cookie) => ['--cookie', cookie]),
  options.originUrl,
  SPEC_FILE,
]

const runBombadilPass = (options: PassOptions): PassOutcome => {
  const started = performance.now()
  const run = xSync('bombadil', bombadilArgs(options), { nodeOptions: { stdio: 'inherit' } })
  const durationSeconds = ((performance.now() - started) / 1000).toFixed(1)
  return { durationSeconds, name: options.name, ok: run.exitCode === 0 }
}

const findServer5xx = (logFile: string): Array<string> =>
  readFileSync(logFile, 'utf8')
    .split('\n')
    .filter((line) => /"status":5\d\d\b/.test(line))

const reportOutcomes = (outcomes: ReadonlyArray<PassOutcome>, serverErrors: ReadonlyArray<string>): number => {
  for (const outcome of outcomes) {
    console.log(`${outcome.ok ? 'ok  ' : 'FAIL'}  bombadil:${outcome.name.padEnd(14)} ${outcome.durationSeconds}s`)
  }
  if (serverErrors.length > 0) {
    console.error(
      `FAIL  server 5xx responses observed (${serverErrors.length}):\n${serverErrors.slice(0, 5).join('\n')}`,
    )
  }
  return outcomes.every((outcome) => outcome.ok) && serverErrors.length === 0 ? 0 : 1
}

const runSuite = async (app: RunningApp, browser: BrowserHandle): Promise<number> => {
  const cookies = await signInCookies(app)
  await seedPosts(app, cookies)
  const outcomes = [
    runBombadilPass({ debuggerUrl: browser.debuggerUrl, name: 'public', originUrl: `${app.url}/` }),
    runBombadilPass({
      cookies,
      debuggerUrl: browser.debuggerUrl,
      name: 'authenticated',
      originUrl: `${app.url}/dashboard`,
    }),
  ]
  return reportOutcomes(outcomes, findServer5xx(LOG_FILE))
}

const main = async (): Promise<void> => {
  mkdirSync(OUTPUT_ROOT, { recursive: true })
  const databaseUrl = testDatabaseUrl('bombadil')
  const app = await startApp({
    databaseUrl,
    logFile: LOG_FILE,
    settings: { AUTH_SIGN_UP: 'closed' },
    trustedProxies: LOOPBACK,
  })
  const browser = await startHeadlessChrome()
  try {
    process.exitCode = await runSuite(app, browser)
  } finally {
    await browser.stop()
    await app.stop()
    if (process.env.KEEP_TEST_DB !== '1') {
      await dropTestDatabase(databaseUrl)
    }
  }
}

await main()
