import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import { post, user } from '#/server/db/schema/index.ts'
import { startApp } from './app-server.ts'
import type { RunningApp } from './app-server.ts'
import { judge, PAGES } from './lighthouse-policy.ts'
import type { FormFactor, Page, PerformanceBar } from './lighthouse-policy.ts'
import { exitCodeOf, progressLine, writeReport } from './lighthouse-report.ts'
import type { PageOutcome } from './lighthouse-report.ts'
import {
  chromeFlags,
  failingAudits,
  findChromium,
  keepMedianReport,
  runLighthouse,
  SHM_BYTES,
  SMALL_SHM,
  summarizeRuns,
} from './lighthouse-runs.ts'
import type { Chrome, Lhr } from './lighthouse-runs.ts'
import { dropTestDatabase, testDatabaseUrl } from './test-db.ts'

const OUT = 'lighthouse-report'

const option = (name: string) => process.argv.find((arg) => arg.startsWith(`--${name}=`))?.split('=')[1]

const oneOf = <T extends string>(name: string, allowed: ReadonlyArray<T>, fallback: Array<T>): Array<T> => {
  const value = option(name)
  if (value === undefined) {
    return fallback
  }
  if (!allowed.includes(value as T)) {
    throw new Error(`--${name} must be one of ${allowed.join(', ')} (got "${value}")`)
  }
  return [value as T]
}

const runs = Number(option('runs') ?? 3)
if (!Number.isInteger(runs) || runs < 1) {
  throw new Error(`--runs must be a positive integer (got "${option('runs')}")`)
}
const formFactors = oneOf<FormFactor>('form-factor', ['mobile', 'desktop'], ['mobile', 'desktop'])
const pageNames = oneOf(
  'page',
  PAGES.map((page) => page.name),
  PAGES.map((page) => page.name),
)
const pages = PAGES.filter((page) => pageNames.includes(page.name))
const direct = process.argv.includes('--direct')
const [performanceBar = 'target'] = oneOf<PerformanceBar>('bar', ['target', 'ci'], ['target'])
const [protocol = 'h2'] = oneOf('edge-protocol', ['h2', 'h1', 'http'] as const, ['h2'])
const tls = !direct && protocol !== 'http'

const POSTS = [
  'Shipped the first version of the contract checks. The SDK now fails CI when it drifts from the served API.',
  'Short posts keep the example honest: rendering, the database, sessions and validation all in one flow.',
  'Measured the public page on a throttled mobile profile. Every category needs to stay at 100.',
  'Reminder to self: the authenticated route is measured too, minus SEO because it is private.',
]

const seedPosts = async (databaseUrl: string, email: string) => {
  const pool = new Pool({ connectionString: databaseUrl })
  try {
    const db = drizzle({ client: pool })
    const [author] = await db.select({ id: user.id }).from(user).where(eq(user.email, email))
    if (!author) {
      throw new Error(`seed author ${email} not found in the user table of ${new URL(databaseUrl).pathname}`)
    }
    await db
      .insert(post)
      .values(POSTS.map((body, i) => ({ authorId: author.id, body, createdAt: new Date(Date.UTC(2026, 0, 1 + i)) })))
  } finally {
    await pool.end()
  }
}

const signIn = async (appUrl: string, credentials: { email: string; password: string }) => {
  const res = await fetch(`${appUrl}/api/auth/sign-in/email`, {
    body: JSON.stringify(credentials),
    headers: { 'content-type': 'application/json', origin: appUrl },
    method: 'POST',
  })
  if (!res.ok) {
    throw new Error(`sign-in as ${credentials.email} failed: ${res.status}, expected 200. ${await res.text()}`)
  }
  return res.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ')
}

type Target = { chrome: Chrome; cookie: string | undefined; url: string }

const measureRuns = (target: Target, page: Page, formFactor: FormFactor): Array<Lhr> =>
  Array.from({ length: runs }, (_, index) => {
    const lhr = runLighthouse({
      chrome: target.chrome,
      cookie: page.auth ? target.cookie : undefined,
      formFactor,
      outputBase: join(OUT, `${page.name}-${formFactor}-${index + 1}`),
      url: target.url + page.path,
    })
    if (lhr.runtimeError) {
      throw new Error(`${page.name} ${formFactor}: ${lhr.runtimeError.message}`)
    }
    if (new URL(lhr.finalDisplayedUrl).pathname !== page.path) {
      throw new Error(`${page.name}: landed on ${lhr.finalDisplayedUrl}, expected the path ${page.path}`)
    }
    return lhr
  })

const measurePage = (target: Target, page: Page, formFactor: FormFactor): PageOutcome => {
  const lhrs = measureRuns(target, page, formFactor)
  const { metrics, perRun, scores } = summarizeRuns(lhrs)
  const { problems, verdict } = judge(page, { formFactor, performanceBar }, { metrics, perRun })
  const { medianLhr, medianRun } = keepMedianReport(lhrs, join(OUT, `${page.name}-${formFactor}`))
  return {
    failingAudits: failingAudits(medianLhr, page.gated),
    formFactor,
    medianRun,
    metrics,
    page: page.name,
    path: page.path,
    perRun,
    problems,
    runs,
    scores,
    verdict,
  }
}

const measureApp = async (app: RunningApp, chromePath: string): Promise<Array<PageOutcome>> => {
  const flags = chromeFlags({ edgeCertificateSpki: app.edgeCertificateSpki, http1: protocol === 'h1' })
  const through = direct ? ' (Node server, no edge)' : ` (edge in front of ${app.directUrl}, ${protocol})`
  console.log(`measuring ${app.url}${through}`)
  await seedPosts(app.databaseUrl, app.user.email)
  const cookie = pages.some((page) => page.auth)
    ? await signIn(app.url, { email: app.user.email, password: app.user.password })
    : undefined
  for (const page of pages) {
    await fetch(app.url + page.path, { headers: page.auth && cookie ? { cookie } : {} })
  }
  const target = { chrome: { flags, path: chromePath }, cookie, url: app.url }
  return pages.flatMap((page) =>
    formFactors.map((formFactor) => {
      const outcome = measurePage(target, page, formFactor)
      console.log(progressLine(outcome))
      return outcome
    }),
  )
}

const chromePath = await findChromium()
if (SMALL_SHM) {
  console.warn(
    `/dev/shm has ${Math.round(SHM_BYTES / 1024 ** 2)} MiB (< 1 GiB): Chrome runs with --disable-dev-shm-usage. ` +
      'In Docker, pass --shm-size=2g.',
  )
}
rmSync(OUT, { force: true, recursive: true })
mkdirSync(OUT, { recursive: true })
const databaseUrl = testDatabaseUrl('lighthouse', process.env.LIGHTHOUSE_DATABASE_URL)
let outcomes: Array<PageOutcome> = []
let app: RunningApp | undefined
try {
  app = await startApp({
    databaseUrl,
    edge: direct ? undefined : { logFile: join(OUT, 'edge.log'), tls },
    logFile: join(OUT, 'app-server.log'),
  })
  outcomes = await measureApp(app, chromePath)
} finally {
  await app?.stop()
  if (!process.env.LIGHTHOUSE_DATABASE_URL) {
    await dropTestDatabase(databaseUrl)
  }
}
writeReport(outcomes, { edge: direct ? false : protocol, outputDir: OUT, runs, shmBytes: SHM_BYTES })
process.exitCode = exitCodeOf(outcomes)
