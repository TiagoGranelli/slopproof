import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { x, xSync } from 'tinyexec'
import {
  binEnv,
  isActiveMigration,
  isEntrypoint,
  isFormatTarget,
  isLintTarget,
  loadExcludedMigrations,
} from './format-edited-file.ts'

export type DriftTarget = 'auth' | 'contract' | 'migrations'
export type CheckChangedOptions = { files: Array<string>; quiet: boolean; since: string }
export type PlannedStep = { args: Array<string>; command: string; fix: string; name: string }
export type CheckPlan = { skipped: Array<string>; steps: Array<PlannedStep>; uiTriggered: boolean }

type PlanConfig = {
  excludedMigrations: ReadonlySet<string>
  existingFiles: ReadonlySet<string>
  since: string
}

type PlanLists = { skipped: Array<string>; steps: Array<PlannedStep> }
type StepOutcome = { durationMs: number; fix: string; name: string; ok: boolean; output: string }

const TS_EXT = /\.(?:ts|tsx|mts|cts)$/
const TESTABLE_EXT = /\.(?:ts|tsx|mts|css)$/
const SRC_CODE_EXT = /\.(?:ts|tsx)$/
const FEATURE_UI_PATH = /^src\/features\/[^/]+\/(?:components|api)\//
const CONTRACT_DRIFT_EXACT = new Set(['openapi-ts.config.ts', 'openapi.json', 'scripts/openapi.ts'])
const TYPECHECK_EXACT = new Set(['package.json', 'pnpm-lock.yaml', 'tsconfig.json'])
const LICENSE_EXACT = new Set(['package.json', 'pnpm-lock.yaml', 'scripts/licenses.ts'])
const OXLINT_FLAGS = ['--type-aware', '--deny-warnings', '--format=agent', '--no-error-on-unmatched-pattern']

const normalizePath = (raw: string): string => raw.replaceAll('\\', '/').replace(/^\.\//, '')

const readSinceValue = (argv: ReadonlyArray<string>, index: number): string => {
  const next = argv[index + 1]
  if (!next || next.startsWith('-')) {
    throw new Error('`--since` requires a git ref (e.g. `--since HEAD` or `--since main`)')
  }
  return next
}

const parseSinceInline = (token: string): string => {
  const ref = token.slice('--since='.length)
  if (ref === '') {
    throw new Error('`--since=` requires a non-empty git ref')
  }
  return ref
}

const consumeOption = (argv: ReadonlyArray<string>, index: number, options: CheckChangedOptions): number => {
  const token = argv[index] ?? ''
  if (token === '--quiet' || token === '-q') {
    options.quiet = true
    return index
  }
  if (token === '--since') {
    options.since = readSinceValue(argv, index)
    return index + 1
  }
  if (token.startsWith('--since=')) {
    options.since = parseSinceInline(token)
    return index
  }
  if (token.startsWith('-')) {
    throw new Error(`Unknown option "${token}". Expected --since <ref>, --quiet, or file paths.`)
  }
  options.files.push(normalizePath(token))
  return index
}

export const parseCheckChangedArgs = (argv: ReadonlyArray<string>): CheckChangedOptions => {
  const options: CheckChangedOptions = { files: [], quiet: false, since: 'HEAD' }
  for (let index = 0; index < argv.length; index++) {
    index = consumeOption(argv, index, options)
  }
  return options
}

export const isUiComponentFile = (file: string): boolean =>
  file.endsWith('.tsx') ||
  file.endsWith('.css') ||
  file.startsWith('src/components/') ||
  file.startsWith('src/styles/') ||
  file.startsWith('tests/component/') ||
  (file.startsWith('src/routes/') && !file.startsWith('src/routes/api/')) ||
  file === 'src/router.tsx' ||
  file === 'src/routeTree.gen.ts' ||
  FEATURE_UI_PATH.test(file)

export const driftTargetsForFiles = (files: ReadonlyArray<string>): Array<DriftTarget> => {
  const targets: Array<DriftTarget> = []
  if (
    files.some(
      (file) => file.startsWith('src/contract/') || file.startsWith('src/sdk/') || CONTRACT_DRIFT_EXACT.has(file),
    )
  ) {
    targets.push('contract')
  }
  if (files.some((file) => file.startsWith('drizzle/') || file.startsWith('src/server/db/schema/'))) {
    targets.push('migrations')
  }
  if (files.some((file) => file === 'src/server/auth.ts' || file === 'src/server/db/schema/auth.ts')) {
    targets.push('auth')
  }
  return targets
}

const isSrcChange = (file: string): boolean =>
  file.startsWith('src/') && !file.startsWith('src/sdk/') && file !== 'src/routeTree.gen.ts' && SRC_CODE_EXT.test(file)

const isTestSubject = (file: string): boolean =>
  (TESTABLE_EXT.test(file) || file === 'openapi.json') && !file.startsWith('drizzle/') && !file.startsWith('src/sdk/')

const recordStep = (lists: PlanLists, name: string, step: PlannedStep | undefined): void => {
  if (step) {
    lists.steps.push(step)
  } else {
    lists.skipped.push(name)
  }
}

const buildTestStep = (testFiles: ReadonlyArray<string>, uiTriggered: boolean): PlannedStep | undefined => {
  if (testFiles.length === 0) {
    return undefined
  }
  const projects = uiTriggered ? ['unit', 'api', 'component'] : ['unit', 'api']
  const projectArgs = projects.flatMap((project) => ['--project', project])
  return {
    args: ['related', ...testFiles, '--run', ...projectArgs, '--passWithNoTests', '--reporter=agent'],
    command: 'vitest',
    fix: uiTriggered ? 'pnpm test:unit && pnpm test:api && pnpm test:component' : 'pnpm test:unit && pnpm test:api',
    name: uiTriggered ? 'tests (unit+api+component)' : 'tests (unit+api)',
  }
}

const formatStep = (files: ReadonlyArray<string>): PlannedStep | undefined =>
  files.length > 0
    ? {
        args: ['--check', '--no-error-on-unmatched-pattern', ...files],
        command: 'oxfmt',
        fix: 'pnpm format',
        name: 'format',
      }
    : undefined

const lintStep = (files: ReadonlyArray<string>): PlannedStep | undefined =>
  files.length > 0
    ? { args: [...OXLINT_FLAGS, ...files], command: 'oxlint', fix: 'pnpm lint:fix', name: 'lint' }
    : undefined

const planStaticSteps = (files: ReadonlyArray<string>, existing: ReadonlySet<string>, lists: PlanLists): void => {
  recordStep(lists, 'format', formatStep(files.filter((file) => existing.has(file) && isFormatTarget(file))))
  recordStep(lists, 'lint', lintStep(files.filter((file) => existing.has(file) && isLintTarget(file))))
  const needsTypecheck = files.some((file) => TS_EXT.test(file) || TYPECHECK_EXACT.has(file))
  const typeStep: PlannedStep = {
    args: ['tsc', '--noEmit'],
    command: 'effect-tsgo',
    fix: 'pnpm exec effect-tsgo tsc --noEmit',
    name: 'typecheck',
  }
  recordStep(lists, 'typecheck', needsTypecheck ? typeStep : undefined)
}

const planFallowSteps = (files: ReadonlyArray<string>, config: PlanConfig, lists: PlanLists): void => {
  const srcFiles = files.filter((file) => isSrcChange(file))
  const fileFlags = srcFiles.flatMap((file) => (config.existingFiles.has(file) ? ['--file', file] : []))
  const deadCode: PlannedStep = {
    args: ['dead-code', '--quiet', '--fail-on-issues', '--changed-since', config.since],
    command: 'fallow',
    fix: 'pnpm deadcode',
    name: 'fallow-deadcode',
  }
  const security: PlannedStep = {
    args: ['security', '--gate', 'new', '--changed-since', config.since, ...fileFlags, 'src'],
    command: 'fallow',
    fix: 'pnpm security:check',
    name: 'fallow-security',
  }
  recordStep(lists, 'fallow-deadcode', srcFiles.length > 0 ? deadCode : undefined)
  recordStep(lists, 'fallow-security', srcFiles.length > 0 ? security : undefined)
}

const migrationStep = (files: ReadonlyArray<string>, config: PlanConfig): PlannedStep | undefined => {
  const active = files.filter(
    (file) => config.existingFiles.has(file) && isActiveMigration(file, config.excludedMigrations),
  )
  if (active.length === 0) {
    return undefined
  }
  return {
    args: ['--config', '.config/squawk.toml', ...active],
    command: 'squawk',
    fix: 'pnpm check:migrations',
    name: 'migrations',
  }
}

const driftStep = (files: ReadonlyArray<string>): PlannedStep | undefined => {
  const targets = driftTargetsForFiles(files)
  if (targets.length === 0) {
    return undefined
  }
  return {
    args: ['scripts/check-drift.ts', ...targets],
    command: process.execPath,
    fix: `pnpm check:drift ${targets.join(' ')}`,
    name: `drift (${targets.join(',')})`,
  }
}

const planGovernanceSteps = (files: ReadonlyArray<string>, config: PlanConfig, lists: PlanLists): void => {
  recordStep(lists, 'migrations', migrationStep(files, config))
  planFallowSteps(files, config, lists)
  recordStep(lists, 'drift', driftStep(files))
  const licenseStep: PlannedStep = {
    args: ['scripts/licenses.ts'],
    command: process.execPath,
    fix: 'pnpm licenses:check',
    name: 'licenses',
  }
  recordStep(lists, 'licenses', files.some((file) => LICENSE_EXACT.has(file)) ? licenseStep : undefined)
}

export const planChecks = (changedFiles: ReadonlyArray<string>, config: PlanConfig): CheckPlan => {
  const files = [...new Set(changedFiles.flatMap((file) => (file ? [normalizePath(file)] : [])))].toSorted()
  const lists: PlanLists = { skipped: [], steps: [] }
  planStaticSteps(files, config.existingFiles, lists)
  const uiTriggered = files.some((file) => isUiComponentFile(file))
  const testFiles = files.filter((file) => config.existingFiles.has(file) && isTestSubject(file))
  if (testFiles.length > 0 && !uiTriggered) {
    lists.skipped.push('component')
  }
  recordStep(lists, 'tests', buildTestStep(testFiles, uiTriggered))
  planGovernanceSteps(files, config, lists)
  return { skipped: lists.skipped, steps: lists.steps, uiTriggered }
}

const discoverChangedFiles = (since: string): Array<string> => {
  const diff = xSync('git', ['diff', '--name-only', since])
  if (diff.exitCode !== 0) {
    throw new Error(`git diff --name-only ${since} failed: ${diff.stderr.trim() || 'invalid git ref'}`)
  }
  const untracked = xSync('git', ['ls-files', '--others', '--exclude-standard'])
  const lines = `${diff.stdout}\n${untracked.stdout}`.split('\n')
  return [...new Set(lines.flatMap((line) => (line.trim() ? [normalizePath(line.trim())] : [])))].toSorted()
}

const runStep = async (step: PlannedStep, env: NodeJS.ProcessEnv): Promise<StepOutcome> => {
  const started = performance.now()
  const outcome = await x(step.command, step.args, { nodeOptions: { env, stdio: ['ignore', 'pipe', 'pipe'] } })
  return {
    durationMs: Math.round(performance.now() - started),
    fix: step.fix,
    name: step.name,
    ok: outcome.exitCode === 0,
    output: `${outcome.stdout}${outcome.stderr}`.trim(),
  }
}

const printFailures = (outcomes: ReadonlyArray<StepOutcome>): void => {
  for (const outcome of outcomes.filter((entry) => !entry.ok)) {
    console.error(`\nFAIL ${outcome.name} (${outcome.durationMs}ms)`)
    if (outcome.output) {
      console.error(outcome.output)
    }
    console.error(`fix: ${outcome.fix}`)
  }
}

const printSummary = (
  outcomes: ReadonlyArray<StepOutcome>,
  plan: CheckPlan,
  summary: { fileCount: number; quiet: boolean; totalMs: number },
): void => {
  const allPassed = outcomes.every((entry) => entry.ok)
  console.log(
    `check:changed ${allPassed ? 'ok' : 'FAIL'} (${summary.fileCount} files, ${outcomes.length} gates, ${summary.totalMs}ms)`,
  )
  if (summary.quiet && allPassed) {
    return
  }
  for (const outcome of outcomes) {
    console.log(`  ${outcome.ok ? 'ok  ' : 'FAIL'} ${outcome.name.padEnd(28)} ${outcome.durationMs}ms`)
  }
  if (plan.skipped.length > 0) {
    console.log(`  skip ${plan.skipped.join(', ')}`)
  }
}

const runPlan = async (plan: CheckPlan, options: { fileCount: number; quiet: boolean }): Promise<void> => {
  const env = binEnv(resolve('.'))
  const started = performance.now()
  const outcomes = await Promise.all(plan.steps.map((step) => runStep(step, env)))
  printFailures(outcomes)
  printSummary(outcomes, plan, { ...options, totalMs: Math.round(performance.now() - started) })
  process.exitCode = outcomes.every((entry) => entry.ok) ? 0 : 1
}

const executeCli = async (): Promise<void> => {
  const options = parseCheckChangedArgs(process.argv.slice(2))
  const files = options.files.length > 0 ? options.files : discoverChangedFiles(options.since)
  if (files.length === 0) {
    console.log('check:changed: no changed files')
    return
  }
  const existingFiles = new Set(files.filter((file) => existsSync(file)))
  const plan = planChecks(files, {
    excludedMigrations: loadExcludedMigrations(resolve('.')),
    existingFiles,
    since: options.since,
  })
  if (plan.steps.length === 0) {
    console.log(`check:changed ok (${files.length} files, 0 gates; skipped: ${plan.skipped.join(', ')})`)
    return
  }
  await runPlan(plan, { fileCount: files.length, quiet: options.quiet })
}

if (isEntrypoint(import.meta.url)) {
  await executeCli()
}
