import { spawnSync } from 'node:child_process'
import { relative, resolve } from 'node:path'
import { pinProblems } from './image-pins.ts'
import { IMAGES } from './images.ts'
import { captureProcess } from './process-log.ts'
import type { ProcessOutput } from './process-log.ts'

const runHost = (command: string, args: Array<string> = [], env: NodeJS.ProcessEnv = {}) => {
  const outcome = spawnSync(command, args, { env: { ...process.env, ...env }, stdio: 'inherit' })
  if (outcome.error) {
    console.error(`${command} did not start: ${outcome.error.message}`)
    return 1
  }
  return outcome.status ?? 1
}

const runPnpm = async (args: Array<string>, env: NodeJS.ProcessEnv = {}) => {
  const { xSync } = await import('tinyexec')
  try {
    return xSync('pnpm', args, { nodeOptions: { env, stdio: 'inherit' } }).exitCode ?? 1
  } catch (error) {
    console.error(`pnpm did not start: ${error instanceof Error ? error.message : String(error)}`)
    return 1
  }
}

const downloadedBuild = process.env.GITHUB_ACTIONS === 'true' ? { ALLOW_STALE_BUILD: '1' } : {}

const runAll = async (checks: Array<[string, () => Promise<ProcessOutput>]>) => {
  const outcomes = await Promise.all(checks.map(async ([name, check]) => ({ name, ...(await check()) })))
  for (const { name, output, status } of outcomes) {
    console.log(`\n▶ ${name}`)
    if (output) {
      process.stdout.write(output.endsWith('\n') ? output : `${output}\n`)
    }
    console.log(status === 0 ? `ok    ${name}` : `FAIL  ${name}`)
  }
  return outcomes.some(({ status }) => status !== 0) ? 1 : 0
}

const OFFLINE = ['--rm', '--network', 'none', '--memory', '512m']
const CHECKOUT_READ_ONLY = ['--volume', `${process.cwd()}:/repo:ro`, '--workdir', '/repo']
const ZIZMOR = [IMAGES.zizmor, '--offline', '--config', '.github/zizmor.yml', '.']
const EXAMPLE_DEPLOY = ['-f', 'deploy/compose.production.yaml', '--env-file', 'deploy/deploy.env.example']
const DEPLOY_READ_ONLY = ['--volume', `${process.cwd()}/deploy:/deploy:ro`]
const KUBERNETES_1_33 = ['-strict', '-summary', '-kubernetes-version', '1.33.0', '/deploy/kubernetes.yaml']

const imagePins = async (): Promise<ProcessOutput> => {
  const problems = pinProblems()
  if (!problems.length) {
    return { output: '', status: 0 }
  }
  const output = `${problems.join('\n')}\nCopy the pin from scripts/images.ts into each file listed.\n`
  return { output, status: 1 }
}

const KUBECONFORM_ARGS = [
  'run',
  '--rm',
  '--memory',
  '256m',
  ...DEPLOY_READ_ONLY,
  IMAGES.kubeconform,
  ...KUBERNETES_1_33,
]

const WORKFLOW_CHECKS: Array<[string, () => Promise<ProcessOutput>]> = [
  [
    'actionlint',
    () => captureProcess('docker', ['run', ...OFFLINE, ...CHECKOUT_READ_ONLY, IMAGES.actionlint, '-color']),
  ],
  ['zizmor', () => captureProcess('docker', ['run', ...OFFLINE, ...CHECKOUT_READ_ONLY, ...ZIZMOR])],
  ['image pins', imagePins],
  ['compose.production.yaml', () => captureProcess('docker', ['compose', ...EXAMPLE_DEPLOY, 'config', '--quiet'])],
  ['kubernetes.yaml', () => captureProcess('docker', KUBECONFORM_ARGS)],
  ['caddy & fly.toml', () => captureProcess(process.execPath, ['scripts/caddy-validate.ts'])],
]

const workflows = () => runAll(WORKFLOW_CHECKS)

const BETTERLEAKS_CONFIG = ['--config', '.config/betterleaks.toml']

const git = (...gitArgs: Array<string>) => spawnSync('git', gitArgs, { encoding: 'utf8' }).stdout.trim()
const secrets = (args: Array<string>) => {
  if (git('rev-parse', '--is-shallow-repository') !== 'false') {
    console.error('secrets: needs the full history (a clone that is not shallow; actions/checkout `fetch-depth: 0`)')
    return 1
  }
  const top = git('rev-parse', '--show-toplevel')
  const common = resolve(git('rev-parse', '--git-common-dir'))
  const dirs = relative(top, common).startsWith('..') ? [top, common] : [top]
  const user = process.getuid ? ['--user', `${process.getuid()}:${process.getgid?.() ?? 0}`] : []
  const safeDirectory = ['GIT_CONFIG_COUNT=1', 'GIT_CONFIG_KEY_0=safe.directory', 'GIT_CONFIG_VALUE_0=*']
  return runHost(
    'docker',
    ['run', '--rm', '--network', 'none', '--memory', '512m', ...user]
      .concat(safeDirectory.flatMap((setting) => ['--env', setting]))
      .concat(dirs.flatMap((dir) => ['--volume', `${dir}:${dir}:ro`]))
      .concat(['--workdir', top, IMAGES.betterleaks, 'git', ...BETTERLEAKS_CONFIG, '--log-opts=HEAD'])
      .concat(['--redact', '--no-banner', ...args, '.']),
  )
}

const supplyChain = async () => {
  let status = 0
  for (const [name, args] of [
    ['registry signatures', ['audit', 'signatures']],
    ['vulnerabilities', ['audit:check']],
  ] as const) {
    console.log(`\n▶ ${name}`)
    const code = await runPnpm([...args])
    console.log(code === 0 ? `ok    ${name}` : `FAIL  ${name}`)
    status ||= code
  }
  return status ? 1 : 0
}

const JOBS = {
  build: (args) =>
    runPnpm(['build', ...args], {
      APP_URL: 'http://localhost:3000',
      BETTER_AUTH_SECRET: 'ci-build-placeholder-secret-not-used-at-runtime',
      DATABASE_URL: 'postgres://build:build@127.0.0.1:1/build',
    }),
  docker: (args) => runHost(process.execPath, ['scripts/docker-smoke.ts', ...args]),
  drift: (args) => runHost(process.execPath, ['scripts/check-drift.ts', ...args]),
  lighthouse: (args) =>
    runHost(
      process.execPath,
      [
        'scripts/lighthouse.ts',
        '--bar=ci',
        ...(args.some((a) => a.startsWith('--runs=')) ? [] : ['--runs=5']),
        ...args,
      ],
      {
        ...downloadedBuild,
      },
    ),
  secrets,
  static: (args) =>
    runPnpm(['check', ...args], {
      CHECK_BASE_REF: process.env.CHECK_BASE_REF ?? 'HEAD^',
      LEFTHOOK_EXCLUDE: 'drift,repo-policy,secrets',
    }),
  'supply-chain': supplyChain,
  verify: (args) =>
    runHost(process.execPath, ['scripts/verify-app.ts', ...args], {
      PW_PROJECTS: process.env.PW_PROJECTS || 'all',
      ...downloadedBuild,
    }),
  workflows,
} satisfies Record<string, (args: Array<string>) => number | Promise<number>>

const isJob = (name: string): name is keyof typeof JOBS => Object.hasOwn(JOBS, name)

const [job, ...rawArgs] = process.argv.slice(2)
const args = rawArgs[0] === '--' ? rawArgs.slice(1) : rawArgs
const selected = job && isJob(job) ? JOBS[job] : undefined
if (!selected) {
  console.error(`usage: node scripts/ci-jobs.ts <${Object.keys(JOBS).join('|')}> [args]`)
  process.exit(2)
}
process.exitCode = await selected(args)
