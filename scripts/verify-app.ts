// The built app end to end, one layer after another: the db layer (tests/db), the integration tests (Vitest) and
// the browser flows (Playwright). Each runner starts and stops its own servers in its global setup
// (scripts/app-server.ts), so any of them also runs alone: `pnpm test:db`, `pnpm test`, `pnpm test:e2e [filter]`.
// Every step runs even after a failure, and a summary follows. Last, the contract-coverage check compares the
// statuses openapi.json declares with those the suites saw: the app servers' request logs, and the api layer,
// which runs first with its recorder on. When nobody watches live, each runner prints only its failures and
// totals (vitest.config.ts, playwright.config.ts), and the summary names the command that reruns a failed layer
// alone, so fixing one failure does not mean running every layer again.
// Usage: pnpm build && pnpm verify:app   (env: PW_PROJECTS, TEST_EDGE=1, KEEP_TEST_DB=1, ALLOW_STALE_BUILD=1)
import { mkdirSync, readdirSync, rmSync } from 'node:fs'
import { xSync } from 'tinyexec'

/** Where tests/api/harness.ts records the api layer's responses for scripts/contract-coverage.ts. */
const CONTRACT_OBSERVATIONS = 'test-results/contract-observations'
/** The request logs of every server this run starts (startApp's `logFile`). */
const isServerLog = (name: string) => /^app-server.*\.log$/.test(name)
const serverLogs = () =>
  readdirSync('test-results')
    .filter((name) => isServerLog(name))
    .map((name) => `test-results/${name}`)

/** A layer, and the command that reruns it alone once it is fixed (a filter narrows it further). */
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
    command: () => [process.execPath, 'scripts/contract-coverage.ts', CONTRACT_OBSERVATIONS, ...serverLogs()],
    name: 'contract coverage',
    // It reads what every other layer recorded, so only a full run checks it.
    alone: 'pnpm verify:app',
  },
]

type StepOutcome = { detail: string; name: string; ok: boolean }

/** Runs one step with the terminal attached; tinyexec puts node_modules/.bin first on PATH. */
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

if (process.argv.length > 2) {
  console.error(
    `verify:app takes no arguments (got ${process.argv.slice(2).join(' ')}). For one layer or file, run its runner: ` +
      '`pnpm test:db [filter]`, `pnpm test [filter]` or `pnpm test:e2e [filter]`.',
  )
  process.exit(2)
}
// Coverage must count this run's responses only.
rmSync(CONTRACT_OBSERVATIONS, { force: true, recursive: true })
mkdirSync('test-results', { recursive: true })
for (const log of serverLogs()) {
  rmSync(log)
}

const outcomes = STEPS.map((step) => run(step))
console.log('')
for (const { detail, name, ok } of outcomes) {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name.padEnd(18)} ${detail}`)
}
process.exitCode = outcomes.every((outcome) => outcome.ok) ? 0 : 1
