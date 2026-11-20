export type Category = 'performance' | 'accessibility' | 'best-practices' | 'seo' | 'agentic-browsing'
export type FormFactor = 'mobile' | 'desktop'
export type Metric = 'fcp' | 'lcp' | 'tbt' | 'cls' | 'si' | 'bytes'

const GATED: Array<Category> = ['performance', 'accessibility', 'best-practices', 'seo']
export const REPORTED: Array<Category> = [...GATED, 'agentic-browsing']

export type Page = { auth?: boolean; gated: Array<Category>; name: string; path: string }

export const PAGES: Array<Page> = [
  { gated: GATED, name: 'home', path: '/' },
  { gated: GATED, name: 'about', path: '/about' },
  { gated: ['performance', 'accessibility', 'best-practices'], name: 'login', path: '/login' },
  { auth: true, gated: ['performance', 'accessibility', 'best-practices'], name: 'dashboard', path: '/dashboard' },
]

export const POLICY = {
  budgets: {
    desktop: { bytes: 300_000, cls: 0.02, fcp: 600, lcp: 700, si: 800, tbt: 50 },
    mobile: { bytes: 300_000, cls: 0.02, fcp: 2000, lcp: 2100, si: 2000, tbt: 150 },
  } satisfies Record<FormFactor, Record<Metric, number>>,
  deterministic: { categories: ['accessibility', 'best-practices', 'seo'] as Array<Category>, everyRun: 100 },
  minBenchmarkIndex: 1000,
  performance: {
    ci: { maxRunsBelow100: Number.POSITIVE_INFINITY, minMedian: 95, minRun: 95 },
    target: { maxRunsBelow100: 1, minMedian: 99, minRun: 95 },
  },
}

const SLOW_CPU_WARNING = 'slower CPU than'

export type Verdict = 'pass' | 'fail' | 'inconclusive'

export type PerformanceBar = keyof typeof POLICY.performance

export type Judging = { formFactor: FormFactor; performanceBar: PerformanceBar }

export type RunSummary = {
  benchmarkIndex: number
  preloadTaskMs: number | null
  run: number
  runWarnings: Array<string>
  scores: Record<Category, number | null>
}

export type Measured = { metrics: Record<Metric, number>; perRun: Array<RunSummary> }

export const median = (values: Array<number>): number => {
  const sorted = values.toSorted((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  const at = (index: number) => sorted[index] ?? Number.NaN
  return sorted.length % 2 ? at(mid) : (at(mid - 1) + at(mid)) / 2
}

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

const performanceFindings = (page: Page, perRun: Array<RunSummary>, performanceBar: PerformanceBar): Findings => {
  if (!page.gated.includes('performance')) {
    return { defects: [], problems: [] }
  }
  const scores = perRun.map((run) => run.scores.performance)
  const values = scores.filter((score): score is number => score !== null)
  if (values.length !== scores.length) {
    return { defects: ['performance: a run has no score'], problems: [] }
  }
  return { defects: [], problems: scoreProblems(values, performanceBar) }
}

const budgetProblems = (formFactor: FormFactor, metrics: Record<Metric, number>): Array<string> =>
  (Object.entries(POLICY.budgets[formFactor]) as Array<[Metric, number]>)
    .filter(([metric, budget]) => !(metrics[metric] <= budget))
    .map(([metric, budget]) => `${metric} ${Number(metrics[metric].toFixed(3))} > budget ${budget}`)

const slowRuns = (perRun: Array<RunSummary>): Array<RunSummary> =>
  perRun.filter(
    (run) => run.benchmarkIndex < POLICY.minBenchmarkIndex || run.runWarnings.some((w) => w.includes(SLOW_CPU_WARNING)),
  )

const slowMachineProblem = (slow: Array<RunSummary>): string =>
  `inconclusive: slow machine (benchmarkIndex ${slow.map((run) => run.benchmarkIndex).join(', ')} in runs ` +
  `${slow.map((run) => run.run).join(', ')}; minimum ${POLICY.minBenchmarkIndex})`

export type Judgement = { problems: Array<string>; verdict: Verdict }

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
