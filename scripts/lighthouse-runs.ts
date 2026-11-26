import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, statfsSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import lighthouse, { desktopConfig, generateReport } from 'lighthouse'
import type { Flags } from 'lighthouse'
import { computeMedianRun } from 'lighthouse/core/lib/median-run.js'
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
  const configured = process.env.CHROME_PATH
  if (configured) {
    if (!existsSync(configured)) {
      throw new Error(`CHROME_PATH does not exist (${configured})`)
    }
    return configured
  }
  const path = (await import('@playwright/test')).chromium.executablePath()
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

const CHROME_QUIET_FLAGS = [
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-background-networking',
  '--disable-default-apps',
  '--disable-extensions',
  '--disable-sync',
  '--metrics-recording-only',
  '--mute-audio',
]

const profileBaseDir = () => (tmpdir().length > 40 && existsSync('/tmp') ? '/tmp' : tmpdir())

const devToolsMatch = (text: string) => /DevTools listening on ws:\/\/[^/]+:(\d+)\//.exec(text)?.[1]

const createPortSettler = (child: ChildProcess, reject: (reason: Error) => void) => {
  let timer: ReturnType<typeof setTimeout> | undefined
  const clear = (reason?: Error) => {
    clearTimeout(timer)
    child.removeAllListeners('error').removeAllListeners('exit').stderr?.removeAllListeners('data')
    if (reason) {
      reject(reason)
    }
  }
  return {
    arm: (ms: number, message: () => string) => (timer = setTimeout(() => clear(new Error(message())), ms)),
    clear,
  }
}

const readDevToolsPort = (child: ChildProcess): Promise<number> =>
  new Promise((resolve, reject) => {
    let stderr = ''
    const { arm, clear } = createPortSettler(child, reject)
    arm(30_000, () => `Chrome DevTools timed out: ${stderr.trim()}`)
    child.once('error', clear)
    child.once('exit', (code) => clear(new Error(`Chrome exited (${code}): ${stderr.trim()}`)))
    child.stderr?.on('data', (chunk: Buffer) => {
      const found = devToolsMatch((stderr += chunk.toString()))
      if (found) {
        clear()
        resolve(Number(found))
      }
    })
  })

const stopChrome = async (child: ChildProcess, profileDir: string) => {
  if (child.exitCode === null && child.signalCode === null) {
    const exited = new Promise<void>((done) => {
      child.once('exit', () => done())
    })
    child.kill('SIGTERM')
    const timer = setTimeout(() => child.kill('SIGKILL'), 5000)
    await exited.finally(() => clearTimeout(timer))
  }
  rmSync(profileDir, { force: true, recursive: true })
}

const launchChrome = async (chrome: Chrome) => {
  const baseDir = profileBaseDir()
  const profileDir = mkdtempSync(join(baseDir, 'lh-'))
  const flags = ['--remote-debugging-port=0', `--user-data-dir=${profileDir}`, ...CHROME_QUIET_FLAGS, ...chrome.flags]
  const child = spawn(chrome.path, [...flags, 'about:blank'], {
    env: { ...process.env, TMPDIR: baseDir },
    stdio: ['ignore', 'ignore', 'pipe'],
  })
  try {
    const port = await readDevToolsPort(child)
    return { port, stop: () => stopChrome(child, profileDir) }
  } catch (error) {
    await stopChrome(child, profileDir)
    throw error
  }
}

const writeJsonReport = (outputBase: string, report: string | Array<string>): Lhr => {
  const json = Array.isArray(report) ? (report[0] ?? '') : report
  writeFileSync(`${outputBase}.report.json`, json)
  return JSON.parse(json) as Lhr
}

const lighthouseFlags = (run: LighthouseRun, port: number): Flags => ({
  disableFullPageScreenshot: true,
  extraHeaders: run.cookie ? { cookie: run.cookie } : undefined,
  logLevel: 'error',
  onlyCategories: REPORTED,
  output: 'json',
  port,
  skipAudits: ['bf-cache'],
})

type WarmRun = { chrome: Chrome; cookie: string | undefined; url: string }

const pageTargetWsUrl = async (port: number): Promise<string> => {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`)
  const targets = (await response.json()) as Array<{ type?: string; webSocketDebuggerUrl?: string }>
  const wsUrl = (targets.find((entry) => entry.type === 'page') ?? targets[0])?.webSocketDebuggerUrl
  if (!response.ok || !wsUrl) {
    throw new Error(`No CDP page target (${response.status})`)
  }
  return wsUrl
}

const sendWarmup = (ws: WebSocket, { cookie, url }: WarmRun): number => {
  const cookieCmds: Array<[string, Record<string, Json>?]> = cookie
    ? [['Network.enable'], ['Network.setExtraHTTPHeaders', { headers: { cookie } }]]
    : []
  const commands: Array<[string, Record<string, Json>?]> = [['Page.enable'], ...cookieCmds, ['Page.navigate', { url }]]
  commands.forEach(([method, params], index) => ws.send(JSON.stringify({ id: index + 1, method, params })))
  return commands.length
}

const attachWarmup = (ws: WebSocket, run: WarmRun, settle: (error?: Error) => void) => {
  let [navId, navigated, loaded] = [0, false, false]
  ws.addEventListener('open', () => (navId = sendWarmup(ws, run)), { once: true })
  ws.addEventListener('error', () => settle(new Error('CDP WebSocket error')), { once: true })
  ws.addEventListener('close', () => settle(new Error('CDP WebSocket closed unexpectedly')), { once: true })
  ws.addEventListener('message', (event) => {
    const packet = JSON.parse(String(event.data)) as { error?: { message?: string }; id?: number; method?: string }
    const nav = new Map(Object.entries(packet)).get('result') as { errorText?: string } | undefined
    const failure = packet.error?.message ?? nav?.errorText
    if (failure) {
      settle(new Error(`CDP error: ${failure}`))
    }
    navigated ||= packet.id === navId
    loaded ||= packet.method === 'Page.loadEventFired'
    if (navigated && loaded) {
      settle()
    }
  })
}

export const warmBrowser = async (run: WarmRun): Promise<void> => {
  const browser = await launchChrome(run.chrome)
  let timer: ReturnType<typeof setTimeout> | undefined
  let ws: WebSocket | undefined
  try {
    ws = new WebSocket(await pageTargetWsUrl(browser.port))
    const socket = ws
    await new Promise<void>((resolve, reject) => {
      timer = setTimeout(() => reject(new Error('CDP warmup timed out after 15000ms')), 15_000)
      attachWarmup(socket, run, (error) => (error ? reject(error) : resolve()))
    })
  } finally {
    clearTimeout(timer)
    if (ws && ws.readyState <= WebSocket.OPEN) {
      ws.close()
    }
    await browser.stop()
  }
}

export const runLighthouse = async (run: LighthouseRun): Promise<Lhr> => {
  const browser = await launchChrome(run.chrome)
  const config = run.formFactor === 'desktop' ? desktopConfig : undefined
  try {
    const outcome = await lighthouse(run.url, lighthouseFlags(run, browser.port), config)
    if (!outcome) {
      throw new Error(`lighthouse returned nothing for ${run.url} (${run.formFactor})`)
    }
    return writeJsonReport(run.outputBase, outcome.report)
  } finally {
    await browser.stop()
  }
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

const numberIn = (entry: AuditItem, key: string): number | undefined =>
  typeof entry[key] === 'number' ? entry[key] : undefined

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
  writeFileSync(`${prefix}-median.report.html`, generateReport(medianLhr as never, 'html'))
  return { medianLhr, medianRun }
}
