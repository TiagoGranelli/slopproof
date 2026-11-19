// Runs of the Lighthouse CLI for the gate (scripts/lighthouse.ts) with Playwright's Chromium, and what the gate
// reads from their reports: scores, metric medians, failing audits and the median run.
import { copyFileSync, existsSync, readFileSync, statfsSync } from 'node:fs'
import { computeMedianRun } from 'lighthouse/core/lib/median-run.js'
import { xSync } from 'tinyexec'
import type { Json } from '#/contract/json.ts'
import { type Category, type FormFactor, type Measured, type Metric, median, REPORTED } from './lighthouse-policy.ts'

/** One row of an audit's details table. */
export type AuditItem = Readonly<Record<string, Json>>

/** The parts of a Lighthouse report (LHR) the gate reads. */
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

/** Playwright's Chromium (or CHROME_PATH), or a clear instruction to install it. */
export const findChromium = async (): Promise<string> => {
  const { chromium } = await import('@playwright/test')
  const path = process.env.CHROME_PATH ?? chromium.executablePath()
  if (!existsSync(path)) {
    throw new Error(`Chromium for Playwright is not installed (${path}). Run: pnpm exec playwright install chromium`)
  }
  return path
}

// Chrome keeps shared memory in /dev/shm, which is 64 MB in a default Docker container: renderers crash or
// stall there and the timings suffer. Below 1 GiB Chrome is told to use /tmp instead (slower, but stable).
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

/**
 * Chrome's flags. `edgeCertificateSpki`: Chrome trusts exactly the key of the edge's local certificate (not every
 * certificate error), so the page is a secure https origin as in production, and best-practices audits see what
 * users would see. `http1`: HTTP/1.1 only, to compare with HTTP/2.
 */
export const chromeFlags = (options: { edgeCertificateSpki?: string; http1: boolean }): Array<string> => [
  '--headless=new',
  '--no-sandbox',
  // Lighthouse opens about:blank, then the page. Chrome 156 loads the page in a new renderer process, and that
  // process can start tracing too late: the trace loses the page's navigationStart and Lighthouse stops with
  // NO_NAVSTART (1 desktop run in 5 on a 4-vCPU CI runner, 1 in 25 locally). One renderer process keeps the page
  // in the process already traced; the metrics do not move. No upstream issue yet. Remove it when 25 desktop runs
  // without it pass: pnpm lighthouse --runs=25 --page=home --form-factor=desktop.
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
  /** Where the reports go: `<outputBase>.report.{json,html}`. */
  outputBase: string
  url: string
}

/** One Lighthouse run of every REPORTED category; returns its report. */
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
  return value == null ? null : Math.round(value * 100)
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

/**
 * Lantern keeps a main-thread task in its simulation only from this duration up; shorter ones are pruned and cost
 * nothing (`SIGNIFICANT_DUR_THRESHOLD_MS` in @paulirish/trace_engine's lantern/graph/PageDependencyGraph.js).
 */
export const LANTERN_TASK_THRESHOLD_MS = 10

const numberIn = (entry: AuditItem, key: string): number | undefined => {
  const value = entry[key]
  return typeof value === 'number' ? value : undefined
}

/**
 * How long the main-thread task ran that requested the page's first stylesheet or script: Chrome's navigation
 * commit, which also creates the page's JavaScript contexts. From LANTERN_TASK_THRESHOLD_MS up, Lantern makes
 * every preloaded script wait for it, times the CPU slowdown (4 on mobile), so the simulated mobile FCP and LCP
 * grow on a contended host (ADR 0011). Null when the report does not show it.
 */
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

/** What the runs of one page and form factor measured: each category's range, each metric's median, each run. */
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

/** Weighted audits of `categories` that did not pass, as `category: title (score)`, without repeats. */
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

/**
 * Lighthouse's own median-run selection (closest to the median FCP and TTI) picks the report to read; its HTML
 * report is copied to `<prefix>-median.report.html`. Returns that run and its number (from 1).
 */
export const keepMedianReport = (lhrs: Array<Lhr>, prefix: string): MedianReport => {
  const medianLhr = computeMedianRun(lhrs as never) as Lhr
  const medianRun = lhrs.indexOf(medianLhr) + 1
  copyFileSync(`${prefix}-${medianRun}.report.html`, `${prefix}-median.report.html`)
  return { medianLhr, medianRun }
}
