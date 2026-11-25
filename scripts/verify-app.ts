import { mkdirSync, readdirSync, rmSync } from 'node:fs'
import { xSync } from 'tinyexec'

const CONTRACT_OBSERVATIONS = 'test-results/contract-observations'
const isServerLog = (name: string) => /^app-server.*\.log$/.test(name)
const serverLogs = () =>
  readdirSync('test-results')
    .filter((name) => isServerLog(name))
    .map((name) => `test-results/${name}`)

type Step = { alone: string; command: () => Array<string>; env?: NodeJS.ProcessEnv; name: string }
const STEPS: Array<Step> = [
  {
    alone: 'pnpm test:api [filter]',
    command: () => ['vitest', 'run', '--project', 'api'],
    env: { CONTRACT_OBSERVATIONS },
    name: 'api (recorded)',
  },
  { alone: 'pnpm test:db [filter]', command: () => ['vitest', 'run', '--project', 'db'], name: 'db' },
  { alone: 'pnpm test [filter]', command: () => ['vitest', 'run', '--project', 'integration'], name: 'integration' },
  { alone: 'pnpm test:e2e [filter]', command: () => ['playwright', 'test'], name: 'e2e' },
  {
    alone: 'pnpm verify:app',
    command: () => [process.execPath, 'scripts/contract-coverage.ts', CONTRACT_OBSERVATIONS, ...serverLogs()],
    name: 'contract coverage',
  },
]

type StepOutcome = { detail: string; name: string; ok: boolean }

const run = (step: Step): StepOutcome => {
  const [tool = '', ...args] = step.command()
  const started = performance.now()
  const { exitCode, signalCode } = xSync(tool, args, {
    nodeOptions: { env: { ...process.env, ...step.env }, stdio: 'inherit' },
  })
  const seconds = `${((performance.now() - started) / 1000).toFixed(1)}s`
  return {
    detail: exitCode === 0 ? seconds : `exit ${exitCode ?? signalCode}, ${seconds}; rerun alone: ${step.alone}`,
    name: step.name,
    ok: exitCode === 0,
  }
}

const CORE_STEPS = new Set(['api (recorded)', 'db', 'integration', 'contract coverage'])
const UNDECLARED_STEP: Step = {
  alone: 'pnpm verify:app -- --only=e2e',
  command: () => [process.execPath, 'scripts/contract-coverage.ts', '--undeclared-only', ...serverLogs()],
  name: 'contract coverage (undeclared)',
}

const selectSteps = (argv: Array<string>) => {
  if (argv.length === 0) {
    return STEPS
  }
  const [flag] = argv
  if (argv.length === 1 && flag === '--only=core') {
    return STEPS.filter((step) => CORE_STEPS.has(step.name))
  }
  if (argv.length === 1 && flag === '--only=e2e') {
    return [...STEPS.filter((step) => step.name === 'e2e'), UNDECLARED_STEP]
  }
  console.error(
    `verify:app takes --only=core, --only=e2e, or no arguments (got ${argv.join(' ')}). For one layer or file, ` +
      'run its runner: `pnpm test:db [filter]`, `pnpm test [filter]` or `pnpm test:e2e [filter]`.',
  )
  process.exit(2)
}

const steps = selectSteps(process.argv.slice(2))
rmSync(CONTRACT_OBSERVATIONS, { force: true, recursive: true })
mkdirSync('test-results', { recursive: true })
for (const log of serverLogs()) {
  rmSync(log)
}

const outcomes = steps.map((step) => run(step))
console.log('')
for (const { detail, name, ok } of outcomes) {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name.padEnd(28)} ${detail}`)
}
process.exitCode = outcomes.every((outcome) => outcome.ok) ? 0 : 1
