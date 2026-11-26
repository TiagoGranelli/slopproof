import { mkdirSync, readdirSync, rmSync } from 'node:fs'
import { delimiter, resolve } from 'node:path'
import { xSync } from 'tinyexec'
import { captureProcess } from './process-log.ts'

const CONTRACT_OBSERVATIONS = 'test-results/contract-observations'
const SHARD_PATTERN = /^\d+\/\d+$/
const BIN_DIR = resolve('node_modules/.bin')

const isServerLog = (name: string) => /^app-server.*\.log$/.test(name)
const serverLogs = () =>
  readdirSync('test-results')
    .filter((name) => isServerLog(name))
    .map((name) => `test-results/${name}`)

type Step = { alone: string; command: () => Array<string>; env?: NodeJS.ProcessEnv; name: string }
type StepOutcome = { detail: string; name: string; ok: boolean }
type Mode = 'all' | 'core' | 'e2e'
type Options = { mode: Mode; shard?: string }

const CORE_PARALLEL_STEPS: Array<Step> = [
  {
    alone: 'pnpm test:api [filter]',
    command: () => ['vitest', 'run', '--project', 'api'],
    env: { CONTRACT_OBSERVATIONS },
    name: 'api (recorded)',
  },
  { alone: 'pnpm test:db [filter]', command: () => ['vitest', 'run', '--project', 'db'], name: 'db' },
  { alone: 'pnpm test [filter]', command: () => ['vitest', 'run', '--project', 'integration'], name: 'integration' },
]

const COVERAGE_STEP: Step = {
  alone: 'pnpm verify:app',
  command: () => [process.execPath, 'scripts/contract-coverage.ts', CONTRACT_OBSERVATIONS, ...serverLogs()],
  name: 'contract coverage',
}

const UNDECLARED_STEP: Step = {
  alone: 'pnpm verify:app -- --only=e2e',
  command: () => [process.execPath, 'scripts/contract-coverage.ts', '--undeclared-only', ...serverLogs()],
  name: 'contract coverage (undeclared)',
}

const e2eStep = (shard: string | undefined): Step => ({
  alone: 'pnpm test:e2e [filter]',
  command: () => ['playwright', 'test', ...(shard ? ['--shard', shard] : [])],
  name: 'e2e',
})

const stepEnv = (step: Step): NodeJS.ProcessEnv => ({
  ...process.env,
  PATH: `${BIN_DIR}${delimiter}${process.env.PATH ?? ''}`,
  ...step.env,
})

const formatOutcome = (step: Step, exit: number | string | null, started: number): StepOutcome => {
  const seconds = `${((performance.now() - started) / 1000).toFixed(1)}s`
  const ok = exit === 0
  return {
    detail: ok ? seconds : `exit ${exit}, ${seconds}; rerun alone: ${step.alone}`,
    name: step.name,
    ok,
  }
}

const runInherited = (step: Step): StepOutcome => {
  const [tool = '', ...args] = step.command()
  const started = performance.now()
  const { exitCode, signalCode } = xSync(tool, args, {
    nodeOptions: { env: stepEnv(step), stdio: 'inherit' },
  })
  return formatOutcome(step, exitCode ?? signalCode, started)
}

const runBuffered = async (step: Step): Promise<StepOutcome & { output: string }> => {
  const [tool = '', ...args] = step.command()
  const started = performance.now()
  const { output, status } = await captureProcess(tool, args, stepEnv(step))
  return { ...formatOutcome(step, status, started), output }
}

const runParallel = async (steps: ReadonlyArray<Step>): Promise<Array<StepOutcome>> => {
  const completed = await Promise.all(steps.map((step) => runBuffered(step)))
  for (const { detail, name, ok, output } of completed) {
    console.log(`\n=== ${name} (${ok ? 'ok' : 'FAIL'}, ${detail}) ===`)
    if (output) {
      process.stdout.write(output.endsWith('\n') ? output : `${output}\n`)
    }
  }
  return completed
}

const usageError = (message: string): never => {
  console.error(message)
  process.exit(2)
}

const validateShard = (raw: string, source: string): string => {
  if (!SHARD_PATTERN.test(raw)) {
    usageError(`verify:app: invalid ${source} "${raw}" (expected <index>/<total>, e.g. 1/2)`)
  }
  const [index = 0, total = 0] = raw.split('/').map(Number)
  if (index < 1 || total < 1 || index > total) {
    usageError(`verify:app: invalid ${source} "${raw}" (expected 1 <= index <= total)`)
  }
  return raw
}

type ParsedFlags = { mode?: Mode; shard?: string }

const parseFlag = (flag: string, parsed: ParsedFlags) => {
  if ((flag === '--only=core' || flag === '--only=e2e') && parsed.mode === undefined) {
    parsed.mode = flag === '--only=core' ? 'core' : 'e2e'
    return
  }
  if (flag.startsWith('--shard=') && parsed.shard === undefined) {
    parsed.shard = validateShard(flag.slice('--shard='.length), '--shard')
    return
  }
  usageError(
    `verify:app takes --only=core, --only=e2e, --shard=<index>/<total>, or no arguments (got ${flag}). ` +
      'For one layer or file, run its runner: `pnpm test:db [filter]`, `pnpm test [filter]` or `pnpm test:e2e [filter]`.',
  )
}

const parseOptions = (argv: Array<string>): Options => {
  const parsed: ParsedFlags = {}
  for (const flag of argv) {
    parseFlag(flag, parsed)
  }
  const envShard = process.env.PW_SHARD?.trim()
  const shard = parsed.shard ?? (envShard ? validateShard(envShard, 'PW_SHARD') : undefined)
  return { mode: parsed.mode ?? 'all', shard }
}

const prepareResultsDir = () => {
  rmSync(CONTRACT_OBSERVATIONS, { force: true, recursive: true })
  mkdirSync('test-results', { recursive: true })
  for (const log of serverLogs()) {
    rmSync(log)
  }
}

const execute = async ({ mode, shard }: Options): Promise<Array<StepOutcome>> => {
  if (mode === 'e2e') {
    return [runInherited(e2eStep(shard)), runInherited(UNDECLARED_STEP)]
  }
  const outcomes = await runParallel(CORE_PARALLEL_STEPS)
  if (mode === 'all') {
    outcomes.push(runInherited(e2eStep(shard)))
  }
  outcomes.push(runInherited(COVERAGE_STEP))
  return outcomes
}

const options = parseOptions(process.argv.slice(2))
prepareResultsDir()
const outcomes = await execute(options)
console.log('')
for (const { detail, name, ok } of outcomes) {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name.padEnd(28)} ${detail}`)
}
process.exitCode = outcomes.every((outcome) => outcome.ok) ? 0 : 1
