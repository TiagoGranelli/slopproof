import { copyFileSync, existsSync, readFileSync, statfsSync } from 'node:fs'
import { computeMedianRun } from 'lighthouse/core/lib/median-run.js'
import { xSync } from 'tinyexec'
import type { Json } from '#/contract/json.ts'
import { median, REPORTED } from './lighthouse-policy.ts'
import type { Category, FormFactor, Measured, Metric } from './lighthouse-policy.ts'

export type AuditItem = Readonly<Record<string, Json>>

export type Lhr = {
  audits: Record<
    string,
    {
      details?: { items?: Array<AuditItem> }
      numericValue?: number
      score: number | null
      scoreDisplayMode: string
      title: string
    }
  >
  categories: Record<string, { auditRefs: Array<{ id: string; weight: number }>; score: number | null }>
  environment: { benchmarkIndex: number }
  finalDisplayedUrl: string
  runtimeError?: { message: string }
  runWarnings: Array<string>
}

const METRIC_AUDITS: Record<Metric, string> = {
  bytes: 'total-byte-weight',
  cls: 'cumulative-layout-shift',
  fcp: 'first-contentful-paint',
  lcp: 'largest-contentful-paint',
  si: 'speed-index',
  tbt: 'total-blocking-time',
}

export const findChromium = async (): Promise<string> => {
  const { chromium } = await import('@playwright/test')
  const path = process.env.CHROME_PATH ?? chromium.executablePath()
  if (!existsSync(path)) {
    throw new Error(`Chromium for Playwright is not installed (${path}). Run: pnpm exec playwright install chromium`)
  }
  return path
}

const sharedMemoryBytes = (): number => {
  try {
    const stats = statfsSync('/dev/shm')
    return stats.blocks * stats.bsize
  } catch {
    return 0
  }
}
export const SHM_BYTES = sharedMemoryBytes()
export const SMALL_SHM = SHM_BYTES < 1024 ** 3

export const chromeFlags = (options: { edgeCertificateSpki?: string; http1: boolean }): Array<string> => [
  '--headless=new',
  '--no-sandbox',
  '--renderer-process-limit=1',
  ...(SMALL_SHM ? ['--disable-dev-shm-usage'] : []),
  ...(options.edgeCertificateSpki ? [`--ignore-certificate-errors-spki-list=${options.edgeCertificateSpki}`] : []),
  ...(options.http1 ? ['--disable-http2', '--disable-quic'] : []),
]

export type Chrome = { flags: Array<string>; path: string }

type LighthouseRun = {
  chrome: Chrome
  cookie: string | undefined
  formFactor: FormFactor
  outputBase: string
  url: string
}

export const runLighthouse = (run: LighthouseRun): Lhr => {
  const args = ['exec', 'lighthouse', run.url, '--output=json', '--output=html', `--output-path=${run.outputBase}`]
    .concat([`--only-categories=${REPORTED.join(',')}`, `--chrome-flags=${run.chrome.flags.join(' ')}`, '--quiet'])
    .concat(run.formFactor === 'desktop' ? ['--preset=desktop'] : [])
    .concat(run.cookie ? [`--extra-headers=${JSON.stringify({ cookie: run.cookie })}`] : [])
  const lighthouse = xSync('pnpm', args, {
    nodeOptions: { env: { CHROME_PATH: run.chrome.path }, stdio: 'inherit' },
    timeout: 180_000,
  })
  if (lighthouse.exitCode !== 0) {
    throw new Error(
      `lighthouse failed for ${run.url} (${run.formFactor}): exit ${lighthouse.exitCode ?? lighthouse.signalCode}, ` +
        'expected 0 (its output is above)',
    )
  }
  return JSON.parse(readFileSync(`${run.outputBase}.report.json`, 'utf8')) as Lhr
}

export const score = (lhr: Lhr, category: Category): number | null => {
  const value = lhr.categories[category]?.score
  return typeof value === 'number' ? Math.round(value * 100) : null
}

export type ScoreRange = { max: number; median: number; min: number }

const scoreRange = (lhrs: Array<Lhr>, category: Category): ScoreRange | null => {
  const values = lhrs.flatMap((lhr) => score(lhr, category) ?? [])
  return values.length ? { max: Math.max(...values), median: median(values), min: Math.min(...values) } : null
}

const byCategory = <T>(value: (category: Category) => T): Record<Category, T> =>
  Object.fromEntries(REPORTED.map((category) => [category, value(category)])) as Record<Category, T>

const metricMedians = (lhrs: Array<Lhr>): Record<Metric, number> =>
  Object.fromEntries(
    Object.entries(METRIC_AUDITS).map(([metric, audit]) => [
      metric,
      median(lhrs.map((lhr) => lhr.audits[audit]?.numericValue ?? Number.NaN)),
    ]),
  ) as Record<Metric, number>

export const LANTERN_TASK_THRESHOLD_MS = 10

const numberIn = (entry: AuditItem, key: string): number | undefined => {
  const value = entry[key]
  return typeof value === 'number' ? value : undefined
}

export const preloadTaskMs = (lhr: Lhr): number | null => {
  const requests = lhr.audits['network-requests']?.details?.items ?? []
  const first = requests.find((request) => request.resourceType === 'Stylesheet' || request.resourceType === 'Script')
  const sentAt = first && numberIn(first, 'rendererStartTime')
  if (sentAt === undefined) {
    return null
  }
  const tasks = lhr.audits['main-thread-tasks']?.details?.items ?? []
  const sender = tasks.find((task) => {
    const start = numberIn(task, 'startTime') ?? Number.NaN
    return start <= sentAt && sentAt <= start + (numberIn(task, 'duration') ?? Number.NaN)
  })
  const duration = sender && numberIn(sender, 'duration')
  return duration === undefined ? null : Math.round(duration * 10) / 10
}

export type RunsSummary = Measured & { scores: Record<Category, ScoreRange | null> }

export const summarizeRuns = (lhrs: Array<Lhr>): RunsSummary => ({
  metrics: metricMedians(lhrs),
  perRun: lhrs.map((lhr, index) => ({
    benchmarkIndex: Math.round(lhr.environment.benchmarkIndex),
    preloadTaskMs: preloadTaskMs(lhr),
    run: index + 1,
    runWarnings: lhr.runWarnings,
    scores: byCategory((category) => score(lhr, category)),
  })),
  scores: byCategory((category) => scoreRange(lhrs, category)),
})

const counts = (audit: Lhr['audits'][string]) =>
  audit.scoreDisplayMode !== 'notApplicable' &&
  audit.scoreDisplayMode !== 'informative' &&
  audit.score !== null &&
  audit.score < 1

export const failingAudits = (lhr: Lhr, categories: Array<Category>): Array<string> => [
  ...new Set(
    categories.flatMap((category) =>
      (lhr.categories[category]?.auditRefs ?? [])
        .filter((ref) => ref.weight > 0)
        .flatMap((ref) => lhr.audits[ref.id] ?? [])
        .filter((audit) => counts(audit))
        .map((audit) => `${category}: ${audit.title} (${audit.score})`),
    ),
  ),
]

type MedianReport = { medianLhr: Lhr; medianRun: number }

export const keepMedianReport = (lhrs: Array<Lhr>, prefix: string): MedianReport => {
  const medianLhr = computeMedianRun(lhrs as never) as Lhr
  const medianRun = lhrs.indexOf(medianLhr) + 1
  copyFileSync(`${prefix}-${medianRun}.report.html`, `${prefix}-median.report.html`)
  return { medianLhr, medianRun }
}
