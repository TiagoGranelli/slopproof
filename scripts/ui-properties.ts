import { type ChildProcess, spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createServer } from 'node:net'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { chromium } from 'playwright'
import { xSync } from 'tinyexec'
import { LOOPBACK, type RunningApp, startApp } from './app-server.ts'
import { dropTestDatabase, testDatabaseUrl } from './test-db.ts'

const TIME_LIMIT = process.env.BOMBADIL_TIME_LIMIT || '15s'
const SPEC_FILE = 'tests/bombadil/app.ts'
const OUTPUT_ROOT = 'test-results/bombadil'
const LOG_FILE = 'test-results/app-server-bombadil.log'
const CHROME_CACHE_DIR = join(homedir(), '.cache', 'b-cdp')

type PassName = 'authenticated' | 'public'

interface RunConfig {
  readonly passes: ReadonlyArray<PassName>
  readonly reproduce?: string
}

interface BrowserHandle {
  readonly debuggerUrl: string
  readonly stop: () => Promise<void>
}

interface PassOptions {
  readonly cookies?: ReadonlyArray<string>
  readonly debuggerUrl: string
  readonly name: PassName
  readonly originUrl: string
  readonly reproduce?: string
}

interface PassOutcome {
  readonly durationSeconds: string
  readonly name: PassName
  readonly ok: boolean
  readonly outputDir: string
}

const flagValue = (argv: ReadonlyArray<string>, flag: string): string | undefined => {
  const prefix = `${flag}=`
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (token?.startsWith(prefix)) {
      return token.slice(prefix.length)
    }
    if (token === flag) {
      return argv[index + 1]
    }
  }
  return undefined
}

const parsePassName = (raw: string): PassName => {
  if (raw === 'public' || raw === 'authenticated') {
    return raw
  }
  throw new Error(`--pass must be "public" or "authenticated" (got "${raw}")`)
}

const inferPassFromTrace = (tracePath: string): PassName => {
  const hasPublic = /(?:^|[/\\])public(?:[/\\]|$)/.test(tracePath)
  const hasAuthenticated = /(?:^|[/\\])authenticated(?:[/\\]|$)/.test(tracePath)
  if (hasAuthenticated && !hasPublic) {
    return 'authenticated'
  }
  if (hasPublic && !hasAuthenticated) {
    return 'public'
  }
  throw new Error(`Cannot infer pass from trace "${tracePath}"; specify --pass=public or --pass=authenticated`)
}

const normalizeTraceDir = (tracePath: string): string =>
  basename(tracePath) === 'trace.jsonl' ? dirname(tracePath) : tracePath

const parseRunConfig = (argv: ReadonlyArray<string>): RunConfig => {
  const rawReproduce = flagValue(argv, '--reproduce') ?? process.env.BOMBADIL_REPRODUCE
  const rawPass = flagValue(argv, '--pass') ?? process.env.BOMBADIL_PASS
  if (rawReproduce) {
    const reproduce = normalizeTraceDir(rawReproduce)
    const pass = rawPass ? parsePassName(rawPass) : inferPassFromTrace(reproduce)
    return { passes: [pass], reproduce }
  }
  return { passes: rawPass ? [parsePassName(rawPass)] : ['public', 'authenticated'] }
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

const passOutputDir = (options: PassOptions): string =>
  join(OUTPUT_ROOT, options.reproduce ? `reproduce-${options.name}` : options.name)

const modeArgs = (reproduce: string | undefined): Array<string> =>
  reproduce ? ['--reproduce', reproduce] : ['--time-limit', TIME_LIMIT, '--exit-on-violation']

const bombadilArgs = (options: PassOptions): Array<string> => [
  'browser',
  'test-external',
  '--remote-debugger',
  options.debuggerUrl,
  '--create-target',
  '--instrument-javascript',
  '',
  ...modeArgs(options.reproduce),
  '--output-path',
  passOutputDir(options),
  '--output-path-overwrite',
  ...(options.cookies ?? []).flatMap((cookie) => ['--cookie', cookie]),
  options.originUrl,
  SPEC_FILE,
]

const runBombadilPass = (options: PassOptions): PassOutcome => {
  const outputDir = passOutputDir(options)
  const started = performance.now()
  const run = xSync('bombadil', bombadilArgs(options), { nodeOptions: { stdio: 'inherit' } })
  const durationSeconds = ((performance.now() - started) / 1000).toFixed(1)
  return { durationSeconds, name: options.name, ok: run.exitCode === 0, outputDir }
}

const findServer5xx = (logFile: string): Array<string> =>
  readFileSync(logFile, 'utf8')
    .split('\n')
    .filter((line) => /"status":5\d\d\b/.test(line))

const reportOutcomes = (outcomes: ReadonlyArray<PassOutcome>, serverErrors: ReadonlyArray<string>): number => {
  for (const outcome of outcomes) {
    const suffix = outcome.ok ? '' : `  trace: ${outcome.outputDir}`
    console.log(
      `${outcome.ok ? 'ok  ' : 'FAIL'}  bombadil:${outcome.name.padEnd(14)} ${outcome.durationSeconds}s${suffix}`,
    )
    if (!outcome.ok) {
      console.log(`      replay: pnpm verify:ui-properties -- --reproduce=${outcome.outputDir} --pass=${outcome.name}`)
    }
  }
  if (serverErrors.length > 0) {
    console.error(
      `FAIL  server 5xx responses observed (${serverErrors.length}):\n${serverErrors.slice(0, 5).join('\n')}`,
    )
  }
  return outcomes.every((outcome) => outcome.ok) && serverErrors.length === 0 ? 0 : 1
}

interface SuiteContext {
  readonly app: RunningApp
  readonly cookies: ReadonlyArray<string>
  readonly debuggerUrl: string
  readonly reproduce?: string
}

const passOptionsFor = (name: PassName, suite: SuiteContext): PassOptions =>
  name === 'public'
    ? { debuggerUrl: suite.debuggerUrl, name, originUrl: `${suite.app.url}/`, reproduce: suite.reproduce }
    : {
        cookies: suite.cookies,
        debuggerUrl: suite.debuggerUrl,
        name,
        originUrl: `${suite.app.url}/dashboard`,
        reproduce: suite.reproduce,
      }

const runSuite = async (app: RunningApp, browser: BrowserHandle, config: RunConfig): Promise<number> => {
  const cookies = await signInCookies(app)
  await seedPosts(app, cookies)
  const suite: SuiteContext = { app, cookies, debuggerUrl: browser.debuggerUrl, reproduce: config.reproduce }
  const outcomes = config.passes.map((name) => runBombadilPass(passOptionsFor(name, suite)))
  return reportOutcomes(outcomes, findServer5xx(LOG_FILE))
}

const main = async (): Promise<void> => {
  const config = parseRunConfig(process.argv.slice(2))
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
    process.exitCode = await runSuite(app, browser, config)
  } finally {
    await browser.stop()
    await app.stop()
    await (process.env.KEEP_TEST_DB === '1' ? Promise.resolve() : dropTestDatabase(databaseUrl))
  }
}

await main()
