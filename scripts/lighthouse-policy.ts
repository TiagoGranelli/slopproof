// What the Lighthouse gate (scripts/lighthouse.ts) measures and demands: the pages, the categories gated on each,
// and POLICY, which turns the runs of one page and form factor into a verdict.

export type Category = 'performance' | 'accessibility' | 'best-practices' | 'seo' | 'agentic-browsing'
export type FormFactor = 'mobile' | 'desktop'
export type Metric = 'fcp' | 'lcp' | 'tbt' | 'cls' | 'si' | 'bytes'

const GATED: Array<Category> = ['performance', 'accessibility', 'best-practices', 'seo']
// Lighthouse 13.5 category; reported but not gated while its audits (llms.txt, WebMCP) are experimental.
export const REPORTED: Array<Category> = [...GATED, 'agentic-browsing']

export type Page = { auth?: boolean; gated: Array<Category>; name: string; path: string }

export const PAGES: Array<Page> = [
  { gated: GATED, name: 'home', path: '/' },
  { gated: GATED, name: 'about', path: '/about' },
  // noindex by design (nothing to find there), so SEO does not apply.
  { gated: ['performance', 'accessibility', 'best-practices'], name: 'login', path: '/login' },
  // Private and noindex by design, so SEO does not apply.
  { auth: true, gated: ['performance', 'accessibility', 'best-practices'], name: 'dashboard', path: '/dashboard' },
]

export const POLICY = {
  /**
   * Categories whose audits are deterministic (DOM, headers, console): every run must score exactly this.
   * A single lower run is a real defect, not noise.
   */
  deterministic: { categories: ['accessibility', 'best-practices', 'seo'] as Array<Category>, everyRun: 100 },
  /**
   * The performance score comes from simulated throttling over a real trace, and simulated mobile FCP/LCP
   * move in ~150 ms steps, so single runs vary by a point or two. Judged by the median, with at most
   * `maxRunsBelow100` imperfect runs and none below `minRun`.
   * - `target`, the project's bar, applies by default (`pnpm lighthouse`).
   * - `ci` (`--bar=ci`, `pnpm ci:lighthouse`): on GitHub's 2-vCPU runners a Chrome task passes Lantern's 10 ms
   *   cutoff and every mobile run of an unchanged page scores 99 (GoogleChrome/lighthouse#16539, ADR 0011). The
   *   bar there is no run below 95; the budgets and the other categories stay as strict. Back to `target`
   *   once Lighthouse stops counting modulepreloads in FCP.
   */
  performance: {
    ci: { maxRunsBelow100: Number.POSITIVE_INFINITY, minMedian: 95, minRun: 95 },
    target: { maxRunsBelow100: 1, minMedian: 99, minRun: 95 },
  },
  /**
   * Hard budgets on the medians (ms, unitless CLS, bytes): a backstop ~30-50% above the measured values.
   * The score gate above is the tighter check.
   */
  budgets: {
    desktop: { bytes: 300_000, cls: 0.02, fcp: 600, lcp: 700, si: 800, tbt: 50 },
    mobile: { bytes: 300_000, cls: 0.02, fcp: 2000, lcp: 2100, si: 2000, tbt: 150 },
  } satisfies Record<FormFactor, Record<Metric, number>>,
  /**
   * Below this `environment.benchmarkIndex` (Lighthouse's own slow-CPU threshold, which also triggers its
   * "slower CPU" run warning) the simulated timings are not comparable: the run is inconclusive (exit 2),
   * neither pass nor fail. An 8-core development machine scores about 4400-4800.
   */
  minBenchmarkIndex: 1000,
}

const SLOW_CPU_WARNING = 'slower CPU than'

export type Verdict = 'pass' | 'fail' | 'inconclusive'

/** Which performance bar a run is judged by (POLICY.performance). */
export type PerformanceBar = keyof typeof POLICY.performance

/** How one page is measured: its form factor and the performance bar that applies. */
export type Judging = { formFactor: FormFactor; performanceBar: PerformanceBar }

/** One Lighthouse run, as the policy reads it. */
export type RunSummary = {
  benchmarkIndex: number
  /** Reported, not judged: see `preloadTaskMs` in scripts/lighthouse-runs.ts. */
  preloadTaskMs: number | null
  run: number
  runWarnings: Array<string>
  scores: Record<Category, number | null>
}

/** The runs of one page and form factor, and the median of each metric over them. */
export type Measured = { metrics: Record<Metric, number>; perRun: Array<RunSummary> }

export const median = (values: Array<number>): number => {
  const sorted = values.toSorted((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  const at = (index: number) => sorted[index] ?? Number.NaN
  return sorted.length % 2 ? at(mid) : (at(mid - 1) + at(mid)) / 2
}

/** Deterministic categories: every run below `everyRun` is a defect. */
const deterministicDefects = (page: Page, perRun: Array<RunSummary>): Array<string> => {
  const { categories, everyRun } = POLICY.deterministic
  return page.gated
    .filter((category) => categories.includes(category))
    .flatMap((category) => {
      const low = perRun.filter((run) => run.scores[category] !== everyRun)
      if (!low.length) {
        return []
      }
      const runs = low.map((run) => `run ${run.run} scored ${run.scores[category] ?? 'nothing'}`).join(', ')
      return [`${category}: ${runs} (every run must be ${everyRun})`]
    })
}

/** Where complete performance scores miss the performanceBar: the median, the lowest run, the count of imperfect runs. */
const scoreProblems = (values: Array<number>, performanceBar: PerformanceBar): Array<string> => {
  const { maxRunsBelow100, minMedian, minRun } = POLICY.performance[performanceBar]
  const below100 = values.filter((score) => score < 100).length
  return [
    ...(median(values) < minMedian ? [`performance: median ${median(values)} < ${minMedian}`] : []),
    ...(Math.min(...values) < minRun
      ? [`performance: unstable, one run scored ${Math.min(...values)} < ${minRun}`]
      : []),
    ...(below100 > maxRunsBelow100
      ? [`performance: ${below100} runs below 100 (${values.join(', ')}); at most ${maxRunsBelow100} tolerated`]
      : []),
  ]
}

type Findings = { defects: Array<string>; problems: Array<string> }

/** The performance score: `defects` when a run has none, `problems` when the scores miss POLICY.performance. */
const performanceFindings = (page: Page, perRun: Array<RunSummary>, performanceBar: PerformanceBar): Findings => {
  if (!page.gated.includes('performance')) {
    return { defects: [], problems: [] }
  }
  const scores = perRun.map((run) => run.scores.performance)
  const values = scores.filter((score): score is number => score !== null)
  // A run without a score fails the page on its own (a defect); the performanceBar applies to complete sets only.
  if (values.length !== scores.length) {
    return { defects: ['performance: a run has no score'], problems: [] }
  }
  return { defects: [], problems: scoreProblems(values, performanceBar) }
}

/** Medians over the form factor's budget. A NaN median (the audit is missing) is over budget too. */
const budgetProblems = (formFactor: FormFactor, metrics: Record<Metric, number>): Array<string> =>
  (Object.entries(POLICY.budgets[formFactor]) as Array<[Metric, number]>)
    .filter(([metric, budget]) => !(metrics[metric] <= budget))
    .map(([metric, budget]) => `${metric} ${Number(metrics[metric].toFixed(3))} > budget ${budget}`)

/** Runs on a machine too slow for the simulated timings to mean anything. */
const slowRuns = (perRun: Array<RunSummary>): Array<RunSummary> =>
  perRun.filter(
    (run) => run.benchmarkIndex < POLICY.minBenchmarkIndex || run.runWarnings.some((w) => w.includes(SLOW_CPU_WARNING)),
  )

const slowMachineProblem = (slow: Array<RunSummary>): string =>
  `inconclusive: slow machine (benchmarkIndex ${slow.map((run) => run.benchmarkIndex).join(', ')} in runs ` +
  `${slow.map((run) => run.run).join(', ')}; minimum ${POLICY.minBenchmarkIndex})`

export type Judgement = { problems: Array<string>; verdict: Verdict }

/**
 * The verdict on one page and form factor. Deterministic categories and measurement problems fail outright; the
 * performance score and the metric budgets are only judged on a machine fast enough for the simulation.
 */
export const judge = (page: Page, { formFactor, performanceBar }: Judging, measured: Measured): Judgement => {
  const performance = performanceFindings(page, measured.perRun, performanceBar)
  const defects = [...deterministicDefects(page, measured.perRun), ...performance.defects]
  const overBudget = [...performance.problems, ...budgetProblems(formFactor, measured.metrics)]
  const slow = slowRuns(measured.perRun)
  const problems = [...defects, ...(slow.length ? [slowMachineProblem(slow)] : []), ...overBudget]
  if (defects.length) {
    return { problems, verdict: 'fail' }
  }
  if (slow.length) {
    return { problems, verdict: 'inconclusive' }
  }
  return { problems, verdict: overBudget.length ? 'fail' : 'pass' }
}
