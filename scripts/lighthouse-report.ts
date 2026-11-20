import { appendFileSync, readFileSync, writeFileSync } from 'node:fs'
import { availableParallelism } from 'node:os'
import { join } from 'node:path'
import {
  type Category,
  type FormFactor,
  type Metric,
  PAGES,
  POLICY,
  REPORTED,
  type Verdict,
} from './lighthouse-policy.ts'
import { LANTERN_TASK_THRESHOLD_MS, type RunsSummary, type ScoreRange } from './lighthouse-runs.ts'

export type PageOutcome = {
  failingAudits: Array<string>
  formFactor: FormFactor
  medianRun: number
  metrics: Record<Metric, number>
  page: string
  path: string
  perRun: RunsSummary['perRun']
  problems: Array<string>
  runs: number
  scores: Record<Category, ScoreRange | null>
  verdict: Verdict
}

export type Setup = { edge: false | string; runs: number; shmBytes: number }

export const progressLine = (outcome: PageOutcome): string => {
  const scores = REPORTED.map((category) => `${category}=${outcome.scores[category]?.median ?? '-'}`).join(' ')
  const performance = outcome.perRun.map((run) => run.scores.performance).join(',')
  const indexes = outcome.perRun.map((run) => run.benchmarkIndex).join(',')
  const preload = outcome.perRun.map((run) => run.preloadTaskMs ?? '-').join(',')
  return `${outcome.verdict.toUpperCase().padEnd(12)} ${outcome.page} ${outcome.formFactor} ${scores} perf runs ${performance} benchmarkIndex ${indexes} preload task ms ${preload}`
}

const formatScore = (range: ScoreRange | null, gated: boolean): string => {
  if (!range) {
    return '–'
  }
  const spread = range.min === range.max ? '' : ` (${range.min}–${range.max})`
  return `${range.median}${spread}${gated ? '' : '*'}`
}

const tableRow = (outcome: PageOutcome): string => {
  const gated = PAGES.find((page) => page.name === outcome.page)?.gated ?? []
  const cells = REPORTED.map((category) => formatScore(outcome.scores[category], gated.includes(category)))
  const { bytes, cls, fcp, lcp, tbt } = outcome.metrics
  const timings = `${Math.round(fcp)} ms | ${Math.round(lcp)} ms | ${Math.round(tbt)} ms | ${cls.toFixed(3)}`
  const problems = outcome.problems.length ? `: ${outcome.problems.join('; ')}` : ''
  return `| ${outcome.path} | ${outcome.formFactor} | ${cells.join(' | ')} | ${timings} | ${Math.round(bytes / 1024)} KiB | ${outcome.verdict}${problems} |`
}

const contendedHostNote = (outcomes: Array<PageOutcome>): string => {
  const tasks = outcomes
    .filter((outcome) => outcome.formFactor === 'mobile')
    .flatMap((outcome) => outcome.perRun.map((run) => run.preloadTaskMs ?? 0))
  const longest = Math.max(0, ...tasks)
  if (longest < LANTERN_TASK_THRESHOLD_MS) {
    return ''
  }
  const counted = tasks.filter((ms) => ms >= LANTERN_TASK_THRESHOLD_MS).length
  return (
    ` Preload task >= ${LANTERN_TASK_THRESHOLD_MS} ms in ${counted} of ${tasks.length} mobile runs (up to ${longest} ms): ` +
    'Lantern adds four times it before every preloaded script, so FCP and LCP grow with the CPU contention of ' +
    'this host (ADR 0011).'
  )
}

const tableIntro = (outcomes: Array<PageOutcome>, setup: Setup): string => {
  const { version } = JSON.parse(readFileSync('node_modules/lighthouse/package.json', 'utf8')) as { version: string }
  const indexes = outcomes.flatMap((outcome) => outcome.perRun.map((run) => run.benchmarkIndex))
  const through = setup.edge === false ? 'Node server without the edge' : `through the Caddy edge (${setup.edge})`
  return (
    `Lighthouse ${version}, median of ${setup.runs} runs, ${through}. ` +
    `benchmarkIndex ${Math.min(...indexes)}–${Math.max(...indexes)}, ${availableParallelism()} CPUs.` +
    contendedHostNote(outcomes) +
    ' * = reported, not gated. Diagnose with `<page>-<form factor>-median.report.html` (Lighthouse median run).'
  )
}

const summaryTable = (outcomes: Array<PageOutcome>, setup: Setup): string =>
  [
    tableIntro(outcomes, setup),
    '',
    '| Page | Form factor | Perf | A11y | Best pr. | SEO | Agentic | FCP | LCP | TBT | CLS | Bytes | Result |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    ...outcomes.map((outcome) => tableRow(outcome)),
  ].join('\n')

const summaryJson = (outcomes: Array<PageOutcome>, setup: Setup) => ({
  cpus: availableParallelism(),
  edge: setup.edge,
  policy: POLICY,
  shmBytes: setup.shmBytes,
  // `results` is summary.json's key for the pages, which people and CI artifacts read; the rule is about names in code.
  // oxlint-disable-next-line eslint/id-denylist
  results: outcomes,
})

export const writeReport = (outcomes: Array<PageOutcome>, setup: Setup & { outputDir: string }): void => {
  const table = summaryTable(outcomes, setup)
  writeFileSync(join(setup.outputDir, 'summary.json'), `${JSON.stringify(summaryJson(outcomes, setup), null, 2)}\n`)
  writeFileSync(join(setup.outputDir, 'summary.md'), `${table}\n`)
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## Lighthouse\n\n${table}\n`)
  }
  console.log(`\n${table}\n`)
  for (const outcome of outcomes.filter(({ failingAudits }) => failingAudits.length)) {
    console.log(
      `${outcome.page} ${outcome.formFactor} audits below 1 (median run ${outcome.medianRun}):\n  ` +
        outcome.failingAudits.join('\n  '),
    )
  }
}

export const exitCodeOf = (outcomes: Array<PageOutcome>): number => {
  const verdicts = new Set(outcomes.map((outcome) => outcome.verdict))
  if (verdicts.has('fail')) {
    return 1
  }
  if (!verdicts.has('inconclusive')) {
    return 0
  }
  console.error('\nInconclusive: this machine measured too slow for the performance score to mean anything (exit 2).')
  return 2
}
