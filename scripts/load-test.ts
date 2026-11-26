import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { WRITES_PER_WINDOW } from '#/contract/limits.ts'
import { LOOPBACK, startApp } from './app-server.ts'
import type { RunningApp } from './app-server.ts'
import { dropTestDatabase, openConnections, testDatabaseUrl } from './test-db.ts'

export const K6_IMAGE = 'grafana/k6:2.4.0@sha256:d41bb79cd8de5a7ad619b53570e3712633e8bff0937010a5c6c57a4747e7a276'

export type LoadMode = 'smoke' | 'soak'

export type LoadOptions = {
  concurrency: number
  durationMs: number
  mode: LoadMode
  targetUrl?: string
  useK6: boolean
}

export type LatencySummary = {
  count: number
  maxMs: number
  p50Ms: number
  p95Ms: number
  p99Ms: number
}

export type LoadReport = {
  leakedConnections: number
  mode: LoadMode
  rateLimitedCount: number
  readLatencies: LatencySummary
  serverErrorCount: number
  unexpectedReadCount: number
  writeAcceptedCount: number
}

type ReadMetrics = { latencies: Array<number>; serverErrors: number; unexpected: number }
type WriteMetrics = { accepted: number; rateLimited: number; serverErrors: number }

const READ_PATHS = ['/', '/api/posts', '/api/ready', '/api/health'] as const
const THRESHOLDS = { p95Ms: 500, p99Ms: 1000 } as const

export const percentile = (sorted: ReadonlyArray<number>, ratio: number): number => {
  if (sorted.length === 0) {
    return 0
  }
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1))
  return Math.round((sorted[index] ?? 0) * 100) / 100
}

export const summarizeLatencies = (samples: ReadonlyArray<number>): LatencySummary => {
  const sorted = samples.toSorted((left, right) => left - right)
  return {
    count: sorted.length,
    maxMs: percentile(sorted, 1),
    p50Ms: percentile(sorted, 0.5),
    p95Ms: percentile(sorted, 0.95),
    p99Ms: percentile(sorted, 0.99),
  }
}

const latencyFailures = (latencies: LatencySummary): Array<string> => {
  const issues: Array<string> = []
  if (latencies.p95Ms > THRESHOLDS.p95Ms) {
    issues.push(`read p95 ${latencies.p95Ms}ms exceeds ${THRESHOLDS.p95Ms}ms`)
  }
  if (latencies.p99Ms > THRESHOLDS.p99Ms) {
    issues.push(`read p99 ${latencies.p99Ms}ms exceeds ${THRESHOLDS.p99Ms}ms`)
  }
  return issues
}

export const evaluateLoadReport = (report: LoadReport, checkedWrites: boolean): Array<string> => {
  const failures = latencyFailures(report.readLatencies)
  if (report.serverErrorCount > 0) {
    failures.push(`observed ${report.serverErrorCount} 5xx responses (expected 0)`)
  }
  if (report.unexpectedReadCount > 0) {
    failures.push(`observed ${report.unexpectedReadCount} non-200 read responses (expected 0)`)
  }
  if (checkedWrites && report.rateLimitedCount === 0) {
    failures.push('write rate-limit probe did not observe any 429 response')
  }
  if (report.leakedConnections > 0) {
    failures.push(`${report.leakedConnections} Postgres connection(s) remained open after shutdown`)
  }
  return failures
}

const parseMode = (raw: string): LoadMode => {
  if (raw === 'smoke' || raw === 'soak') {
    return raw
  }
  throw new Error(`--mode must be smoke or soak (got "${raw}")`)
}

type DraftOptions = {
  concurrency?: number
  durationMs?: number
  mode: LoadMode
  targetUrl?: string
  useK6: boolean
}

const applyLoadFlag = (arg: string, draft: DraftOptions): void => {
  if (arg.startsWith('--mode=')) {
    draft.mode = parseMode(arg.slice(7))
  } else if (arg === '--k6') {
    draft.useK6 = true
  } else if (arg.startsWith('--target=')) {
    draft.targetUrl = arg.slice(9)
  } else if (arg.startsWith('--duration=')) {
    draft.durationMs = Math.max(1000, Number(arg.slice(11)))
  } else if (arg.startsWith('--concurrency=')) {
    draft.concurrency = Math.max(1, Number(arg.slice(14)))
  }
}

export const parseLoadArgs = (argv: ReadonlyArray<string>): LoadOptions => {
  const draft: DraftOptions = {
    mode: 'smoke',
    targetUrl: process.env.TARGET_URL?.trim() || undefined,
    useK6: false,
  }
  for (const arg of argv) {
    applyLoadFlag(arg, draft)
  }
  return {
    concurrency: draft.concurrency ?? (draft.mode === 'smoke' ? 8 : 12),
    durationMs: draft.durationMs ?? (draft.mode === 'smoke' ? 5000 : 30_000),
    mode: draft.mode,
    targetUrl: draft.targetUrl,
    useK6: draft.useK6,
  }
}

const signInCookie = async (baseUrl: string, account: { email: string; password: string }): Promise<string> => {
  const response = await fetch(`${baseUrl}/api/auth/sign-in/email`, {
    body: JSON.stringify(account),
    headers: { 'content-type': 'application/json', origin: baseUrl, 'x-forwarded-for': '198.51.100.10' },
    method: 'POST',
  })
  await response.arrayBuffer()
  const cookie = response.headers
    .getSetCookie()
    .map((header) => header.split(';', 1)[0] ?? '')
    .find((pair) => pair.includes('session_token='))
  if (!response.ok || !cookie) {
    throw new Error(`load-test sign-in failed with ${response.status}`)
  }
  return cookie
}

const recordReadStatus = (status: number, metrics: ReadMetrics): void => {
  if (status >= 500) {
    metrics.serverErrors += 1
  } else if (status !== 200) {
    metrics.unexpected += 1
  }
}

const runReadWorker = async (
  spec: { baseUrl: string; deadline: number; workerId: number },
  metrics: ReadMetrics,
): Promise<void> => {
  let step = spec.workerId
  while (performance.now() < spec.deadline) {
    const path = READ_PATHS[step % READ_PATHS.length] ?? '/'
    step += 1
    const started = performance.now()
    const response = await fetch(`${spec.baseUrl}${path}`)
    await response.arrayBuffer()
    metrics.latencies.push(performance.now() - started)
    recordReadStatus(response.status, metrics)
  }
}

const driveReads = async (baseUrl: string, durationMs: number, concurrency: number): Promise<ReadMetrics> => {
  const deadline = performance.now() + durationMs
  const metrics: ReadMetrics = { latencies: [], serverErrors: 0, unexpected: 0 }
  await Promise.all(
    Array.from({ length: concurrency }, (_, workerId) => runReadWorker({ baseUrl, deadline, workerId }, metrics)),
  )
  return metrics
}

const sendWrite = async (baseUrl: string, cookie: string, idx: number): Promise<number> => {
  const response = await fetch(`${baseUrl}/api/me/posts`, {
    body: JSON.stringify({ body: `load probe post ${idx}` }),
    headers: { 'content-type': 'application/json', cookie, origin: baseUrl },
    method: 'POST',
  })
  await response.arrayBuffer()
  return response.status
}

const driveWriteProbe = async (baseUrl: string, cookie: string): Promise<WriteMetrics> => {
  const statuses = await Promise.all(
    Array.from({ length: WRITES_PER_WINDOW + 5 }, (_, idx) => sendWrite(baseUrl, cookie, idx)),
  )
  return {
    accepted: statuses.filter((code) => code === 201).length,
    rateLimited: statuses.filter((code) => code === 429).length,
    serverErrors: statuses.filter((code) => code >= 500).length,
  }
}

const runK6Container = (options: LoadOptions, baseUrl: string, authCookie: string): number => {
  const script = options.mode === 'smoke' ? '/load/smoke.k6.js' : '/load/soak.k6.js'
  const args = ['run', '--rm', '--network', 'host', '--volume', `${resolve('tests/load')}:/load:ro`]
    .concat(['--env', `BASE_URL=${baseUrl}`])
    .concat(authCookie ? ['--env', `AUTH_COOKIE=${authCookie}`] : [])
    .concat([K6_IMAGE, 'run', script])
  return spawnSync('docker', args, { stdio: 'inherit' }).status ?? 1
}

const printLoadReport = (report: LoadReport, failures: ReadonlyArray<string>): void => {
  const { readLatencies } = report
  console.log(
    `load:${report.mode} reads=${readLatencies.count} p50=${readLatencies.p50Ms}ms p95=${readLatencies.p95Ms}ms p99=${readLatencies.p99Ms}ms max=${readLatencies.maxMs}ms`,
  )
  console.log(
    `load:${report.mode} 5xx=${report.serverErrorCount} writes_201=${report.writeAcceptedCount} writes_429=${report.rateLimitedCount} leaked_conns=${report.leakedConnections}`,
  )
  for (const failure of failures) {
    console.error(`FAIL  ${failure}`)
  }
}

const measureLeakedConnections = async (
  app: RunningApp | undefined,
  databaseUrl: string | undefined,
): Promise<number> => {
  if (!app || !databaseUrl) {
    return 0
  }
  await app.stop()
  const remaining = await openConnections(databaseUrl)
  return remaining.reduce((sum, entry) => sum + entry.n, 0)
}

const buildLoadReport = (
  mode: LoadMode,
  reads: ReadMetrics,
  writes: WriteMetrics & { leakedConnections: number },
): LoadReport => ({
  leakedConnections: writes.leakedConnections,
  mode,
  rateLimitedCount: writes.rateLimited,
  readLatencies: summarizeLatencies(reads.latencies),
  serverErrorCount: reads.serverErrors + writes.serverErrors,
  unexpectedReadCount: reads.unexpected,
  writeAcceptedCount: writes.accepted,
})

const executeNativeLoad = async (
  options: LoadOptions,
  context: { app?: RunningApp; baseUrl: string; cookie: string; databaseUrl?: string },
): Promise<number> => {
  const reads = await driveReads(context.baseUrl, options.durationMs, options.concurrency)
  const writes = context.cookie
    ? await driveWriteProbe(context.baseUrl, context.cookie)
    : { accepted: 0, rateLimited: 0, serverErrors: 0 }
  const leakedConnections = await measureLeakedConnections(context.app, context.databaseUrl)
  const report = buildLoadReport(options.mode, reads, { ...writes, leakedConnections })
  const failures = evaluateLoadReport(report, Boolean(context.cookie))
  printLoadReport(report, failures)
  return failures.length === 0 ? 0 : 1
}

const bootLoadApp = (mode: LoadMode, databaseUrl: string) =>
  startApp({ databaseUrl, logFile: `test-results/app-server-load-${mode}.log`, trustedProxies: LOOPBACK })

const main = async (): Promise<void> => {
  const options = parseLoadArgs(process.argv.slice(2))
  const databaseUrl = options.targetUrl ? undefined : testDatabaseUrl('load')
  const app = databaseUrl ? await bootLoadApp(options.mode, databaseUrl) : undefined
  try {
    const baseUrl = options.targetUrl ?? app?.url ?? ''
    const cookie = app ? await signInCookie(baseUrl, app.user) : ''
    process.exitCode = options.useK6
      ? runK6Container(options, baseUrl, cookie)
      : await executeNativeLoad(options, { app, baseUrl, cookie, databaseUrl })
  } finally {
    await app?.stop()
    if (databaseUrl) {
      await dropTestDatabase(databaseUrl)
    }
  }
}

if (import.meta.main) {
  await main()
}
