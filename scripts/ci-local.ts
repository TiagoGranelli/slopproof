import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { xSync } from 'tinyexec'
import { dockerPrefix } from './images.ts'

const ORDER = ['workflows', 'secrets', 'static', 'supply-chain', 'drift', 'build', 'verify', 'lighthouse', 'docker']
const HOST_JOBS = new Set(['workflows', 'secrets', 'docker'])

const requested = process.argv.slice(2)
const unknown = requested.filter((job) => !ORDER.includes(job))
if (unknown.length) {
  console.error(`unknown job(s): ${unknown.join(', ')}; expected ${ORDER.join(' ')}`)
  process.exit(2)
}
const jobs = new Set(requested.length ? requested : ORDER)
if ((jobs.has('verify') || jobs.has('lighthouse')) && !jobs.has('build')) {
  console.log('adding build: verify and lighthouse test the build of this run')
  jobs.add('build')
}
const plan = ORDER.filter((job) => jobs.has(job))

const git = (...args: Array<string>) => spawnSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 2 ** 20 }).stdout
const TOP = git('rev-parse', '--show-toplevel').trim()
const RESULTS = resolve('test-results/ci-local')
const PROJECT = `${dockerPrefix()}-local-${process.pid}`
const { packageManager } = JSON.parse(readFileSync('package.json', 'utf8')) as { packageManager: string }
const env = {
  ...process.env,
  CI_DOCKER_PREFIX: dockerPrefix(),
  CI_LOCAL_GIT: resolve(git('rev-parse', '--git-common-dir').trim()),
  CI_LOCAL_RESULTS: RESULTS,
  CI_LOCAL_TOP: TOP,
  PNPM_VERSION: packageManager.replace(/^pnpm@/, '').replace(/\+.*$/, ''),
}

const compose = (args: Array<string>, input?: string) =>
  spawnSync('docker', ['compose', '-p', PROJECT, '-f', '.github/compose.ci.yaml', ...args], {
    env,
    input,
    stdio: [input === undefined ? 'inherit' : 'pipe', 'inherit', 'inherit'],
  }).status ?? 1

const inRunner = (step: string, command: Array<string>, input?: string) => {
  const noTty = input === undefined ? [] : ['-T']
  const owner = ['-e', `STEP=${step}`, '-e', `HOST_UID=${process.getuid?.() ?? 0}`]
  return compose(['run', '--rm', ...noTty, ...owner, 'runner', ...command], input)
}

const COPY_CHECKOUT = [
  `git clone --quiet --depth 2 "file://${TOP}" .`,
  'find . -mindepth 1 -maxdepth 1 ! -name .git -exec rm -rf {} +',
  `tar -C "${TOP}" --null -T - -cf - | tar -xf -`,
  'pnpm install --frozen-lockfile --store-dir /pnpm-store --reporter=append-only',
].join(' && ')
const checkoutFiles = () => {
  const deleted = new Set(git('ls-files', '-z', '--deleted').split('\0'))
  return git('ls-files', '-z', '--cached', '--others', '--exclude-standard')
    .split('\0')
    .filter((file) => file !== '' && !deleted.has(file))
}

type Row = { job: string; peakBytes?: number; seconds: number; status: number }
const timed = (job: string, run: () => number): Row => {
  const started = performance.now()
  const status = run()
  const seconds = (performance.now() - started) / 1000
  const peakFile = `${RESULTS}/${job}/memory.peak`
  const peakBytes = existsSync(peakFile) ? Number(readFileSync(peakFile, 'utf8')) : undefined
  return { job, peakBytes, seconds, status }
}

const prepareRunner = () => {
  spawnSync('docker', ['volume', 'create', `${dockerPrefix()}-pnpm-store`], { stdio: 'ignore' })
  if (compose(['build', 'runner']) !== 0) {
    return { job: 'runner image', seconds: 0, status: 1 }
  }
  const files = checkoutFiles()
  console.log(`▶ copy ${files.length} files into the runner's checkout; pnpm install --frozen-lockfile`)
  return timed('setup', () => inRunner('setup', ['sh', '-c', COPY_CHECKOUT], `${files.join('\0')}\0`))
}

const runContainerJobs = (containerJobs: Array<string>) => {
  const rows = [prepareRunner()]
  if (rows[0]?.status !== 0) {
    return rows
  }
  for (const job of containerJobs) {
    console.log(`\n▶ ci:${job} (container)`)
    rows.push(timed(job, () => inRunner(job, ['pnpm', `ci:${job}`])))
    if (job === 'build' && rows.at(-1)?.status !== 0) {
      console.error(`build failed (exit ${rows.at(-1)?.status}): skipping the jobs that need it`)
      break
    }
  }
  return rows
}

const cleanup = () => compose(['down', '--volumes', '--rmi', 'local', '--remove-orphans'])
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    cleanup()
    process.exit(130)
  })
}

rmSync(RESULTS, { force: true, recursive: true })
mkdirSync(RESULTS, { recursive: true })
const rows: Array<Row> = []
const containerJobs = plan.filter((job) => !HOST_JOBS.has(job))
try {
  if (containerJobs.length) {
    rows.push(...runContainerJobs(containerJobs))
  }
} finally {
  cleanup()
}
for (const job of plan.filter((j) => HOST_JOBS.has(j))) {
  console.log(`\n▶ ci:${job} (host)`)
  rows.push(timed(job, () => xSync('pnpm', [`ci:${job}`], { nodeOptions: { stdio: 'inherit' } }).exitCode ?? 1))
}

const gib = (bytes: number | undefined) => (bytes === undefined ? 'n/a' : `${(bytes / 1024 ** 3).toFixed(2)} GiB`)
const outcome = (status: number) => {
  if (status === 0) {
    return 'ok'
  }
  return status === 2 ? 'INCONCLUSIVE' : `FAIL (${status})`
}
const runStatus = (statuses: Array<number>) => {
  if (statuses.some((status) => status !== 0 && status !== 2)) {
    return 1
  }
  return statuses.includes(2) ? 2 : 0
}
console.log('\nci:local (reports in test-results/ci-local/)')
console.log('job            result         time   peak memory (cgroup memory.peak, page cache included)')
for (const row of rows) {
  console.log(
    `${row.job.padEnd(14)} ${outcome(row.status).padEnd(12)} ${row.seconds.toFixed(0).padStart(5)}s   ${gib(row.peakBytes)}`,
  )
}
process.exitCode = runStatus(rows.map((row) => row.status))
