import { spawnSync } from 'node:child_process'
import { relative, resolve } from 'node:path'
import { xSync } from 'tinyexec'
import { pinProblems } from './image-pins.ts'
import { IMAGES } from './images.ts'

const run = (command: string, args: Array<string> = [], env: NodeJS.ProcessEnv = {}) => {
  try {
    return xSync(command, args, { nodeOptions: { env, stdio: 'inherit' } }).exitCode ?? 1
  } catch (error) {
    console.error(`${command} did not start: ${error instanceof Error ? error.message : String(error)}`)
    return 1
  }
}

const downloadedBuild = process.env.GITHUB_ACTIONS === 'true' ? { ALLOW_STALE_BUILD: '1' } : {}

const sequence = (steps: Array<[string, () => number]>) => {
  const failed = steps.filter(([name, step]) => {
    console.log(`\n▶ ${name}`)
    const status = step()
    console.log(status === 0 ? `ok    ${name}` : `FAIL  ${name}`)
    return status !== 0
  })
  return failed.length ? 1 : 0
}

const OFFLINE = ['--rm', '--network', 'none', '--memory', '512m']
const CHECKOUT_READ_ONLY = ['--volume', `${process.cwd()}:/repo:ro`, '--workdir', '/repo']
const ZIZMOR = [IMAGES.zizmor, '--offline', '--config', '.github/zizmor.yml', '.']

const workflows = () =>
  sequence([
    ['actionlint', () => run('docker', ['run', ...OFFLINE, ...CHECKOUT_READ_ONLY, IMAGES.actionlint, '-color'])],
    ['zizmor', () => run('docker', ['run', ...OFFLINE, ...CHECKOUT_READ_ONLY, ...ZIZMOR])],
    ['image pins', imagePins],
    ['deploy recipes', deployRecipes],
  ])

const EXAMPLE_DEPLOY = ['-f', 'deploy/compose.production.yaml', '--env-file', 'deploy/deploy.env.example']
const DEPLOY_READ_ONLY = ['--volume', `${process.cwd()}/deploy:/deploy:ro`]
const KUBERNETES_1_33 = ['-strict', '-summary', '-kubernetes-version', '1.33.0', '/deploy/kubernetes.yaml']

const deployRecipes = () =>
  sequence([
    ['compose.production.yaml', () => run('docker', ['compose', ...EXAMPLE_DEPLOY, 'config', '--quiet'])],
    [
      'kubernetes.yaml',
      () =>
        run('docker', ['run', '--rm', '--memory', '256m', ...DEPLOY_READ_ONLY, IMAGES.kubeconform, ...KUBERNETES_1_33]),
    ],
  ])

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
  return run(
    'docker',
    ['run', '--rm', '--network', 'none', '--memory', '512m', ...user]
      .concat(safeDirectory.flatMap((setting) => ['--env', setting]))
      .concat(dirs.flatMap((dir) => ['--volume', `${dir}:${dir}:ro`]))
      .concat(['--workdir', top, IMAGES.betterleaks, 'git', ...BETTERLEAKS_CONFIG, '--log-opts=HEAD'])
      .concat(['--redact', '--no-banner', ...args, '.']),
  )
}

const imagePins = () => {
  const problems = pinProblems()
  for (const problem of problems) {
    console.error(problem)
  }
  if (problems.length) {
    console.error('Copy the pin from scripts/images.ts into each file listed.')
  }
  return problems.length ? 1 : 0
}

const JOBS = {
  build: (args) =>
    run('pnpm', ['build', ...args], {
      APP_URL: 'http://localhost:3000',
      BETTER_AUTH_SECRET: 'ci-build-placeholder-secret-not-used-at-runtime',
      DATABASE_URL: 'postgres://build:build@127.0.0.1:1/build',
    }),
  docker: (args) => run('node', ['scripts/docker-smoke.ts', ...args]),
  drift: (args) => run('node', ['scripts/check-drift.ts', ...args]),
  lighthouse: (args) =>
    run(
      'node',
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
    run('pnpm', ['check', ...args], {
      CHECK_BASE_REF: process.env.CHECK_BASE_REF ?? 'HEAD^',
      LEFTHOOK_EXCLUDE: 'drift',
    }),
  'supply-chain': () =>
    sequence([
      ['registry signatures', () => run('pnpm', ['audit', 'signatures'])],
      ['vulnerabilities', () => run('pnpm', ['audit:check'])],
    ]),
  verify: (args) =>
    run('node', ['scripts/verify-app.ts', ...args], {
      PW_PROJECTS: process.env.PW_PROJECTS || 'all',
      ...downloadedBuild,
    }),
  workflows,
} satisfies Record<string, (args: Array<string>) => number>

const isJob = (name: string): name is keyof typeof JOBS => Object.hasOwn(JOBS, name)

const [job, ...args] = process.argv.slice(2)
const selected = job && isJob(job) ? JOBS[job] : undefined
if (!selected) {
  console.error(`usage: node scripts/ci-jobs.ts <${Object.keys(JOBS).join('|')}> [args]`)
  process.exit(2)
}
process.exitCode = selected(args)
