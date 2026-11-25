import { spawn, spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { dockerPrefix, IMAGES } from './images.ts'

const PROJECT = `${dockerPrefix()}-smoke-${process.pid}`
const IMAGE = `${PROJECT}-app:smoke`
const GRYPE_DB = `${dockerPrefix()}-grype-db`
const ORIGIN = 'http://localhost:8080'
const MIGRATIONS = (JSON.parse(readFileSync('drizzle/meta/_journal.json', 'utf8')) as { entries: Array<unknown> })
  .entries.length
const MAX_STOP_MS = 8000

const secret = () => randomBytes(24).toString('hex')
const env = {
  ...process.env,
  APP_DB_PASSWORD: secret(),
  APP_IMAGE: IMAGE,
  BETTER_AUTH_SECRET: randomBytes(32).toString('base64'),
  DOMAIN: 'localhost',
  POSTGRES_PASSWORD: secret(),
}
const COMPOSE = ['compose', '-p', PROJECT, '-f', 'deploy/compose.production.yaml', '-f', 'deploy/compose.smoke.yaml']

const compose = (args: Array<string>, input?: string) => {
  const run = spawnSync('docker', [...COMPOSE, ...args], { encoding: 'utf8', env, input, maxBuffer: 64 * 2 ** 20 })
  if (run.status !== 0) {
    throw new Error(
      `docker compose ${args.join(' ')} failed (exit ${run.status ?? run.signal}, expected 0)\n${run.stderr}`,
    )
  }
  return run.stdout.trim()
}

const composeAsync = (args: Array<string>) =>
  new Promise<string>((done, reject) => {
    const child = spawn('docker', [...COMPOSE, ...args], { env, stdio: ['ignore', 'pipe', 'pipe'] })
    let [stdout, stderr] = ['', '']
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()))
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()))
    child.once('error', reject)
    child.once('exit', (code) =>
      code === 0
        ? done(stdout.trim())
        : reject(new Error(`docker compose ${args.join(' ')} failed (exit ${code}, expected 0)\n${stderr}`)),
    )
  })

const step = async <T>(name: string, run: () => T | Promise<T>): Promise<T> => {
  const started = performance.now()
  console.log(`\n▶ ${name}`)
  const value = await run()
  console.log(`  done in ${((performance.now() - started) / 1000).toFixed(1)}s`)
  return value
}

type ScanOutcome = { ms: number; output: string; status: number | null }
type ActiveScan = { child: ReturnType<typeof spawn>; done: Promise<ScanOutcome> }

const grypeDbMount = () => {
  const dir = process.env.GRYPE_DB_DIR?.trim()
  if (!dir) {
    return GRYPE_DB
  }
  mkdirSync(dir, { recursive: true })
  return resolve(dir)
}

const buildxCacheArgs = (cachePath: string, nextCachePath: string, writeCache: boolean) => {
  const from = existsSync(resolve(cachePath, 'index.json')) ? ['--cache-from', `type=local,src=${cachePath}`] : []
  if (!writeCache) {
    return from
  }
  rmSync(nextCachePath, { force: true, recursive: true })
  return [...from, '--cache-to', `type=local,dest=${nextCachePath},mode=max`]
}

const buildWithLocalCache = (cacheDir: string) => {
  const cachePath = resolve(cacheDir)
  const nextCachePath = `${cachePath}.new`
  const writeCache = process.env.DOCKER_BUILD_CACHE_WRITE !== '0'
  const cacheArgs = buildxCacheArgs(cachePath, nextCachePath, writeCache)
  const buildx = spawnSync('docker', ['buildx', 'build', '--load', ...cacheArgs, '-t', IMAGE, '.'], {
    stdio: 'inherit',
  })
  if (buildx.status !== 0) {
    rmSync(nextCachePath, { force: true, recursive: true })
    throw new Error(`docker buildx build failed (exit ${buildx.status ?? buildx.signal}, expected 0)`)
  }
  if (writeCache && existsSync(nextCachePath)) {
    rmSync(cachePath, { force: true, recursive: true })
    renameSync(nextCachePath, cachePath)
  }
}

const buildImage = () => {
  const cacheDir = process.env.DOCKER_BUILD_CACHE_DIR?.trim()
  if (cacheDir) {
    buildWithLocalCache(cacheDir)
  } else {
    compose(['build', 'migrate'])
  }
}

const grypeArgs = () =>
  ['run', '--rm', '--memory', '2g', '--volume', '/var/run/docker.sock:/var/run/docker.sock']
    .concat(['--volume', `${grypeDbMount()}:/grype-db`, '--env', 'GRYPE_DB_CACHE_DIR=/grype-db'])
    .concat(['--volume', `${resolve('.config/grype.yaml')}:/grype.yaml:ro`, IMAGES.grype, `docker:${IMAGE}`])
    .concat(['--only-fixed', '--fail-on', 'high', '--config', '/grype.yaml'])

const startScanImage = (): ActiveScan => {
  const started = performance.now()
  const child = spawn('docker', grypeArgs(), { stdio: ['ignore', 'pipe', 'pipe'] })
  let output = ''
  child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString()))
  child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString()))
  const done = new Promise<ScanOutcome>((doneScan) => {
    child.once('error', (error) =>
      doneScan({ ms: performance.now() - started, output: `${output}\n${error.message}`, status: 1 }),
    )
    child.once('exit', (status) => doneScan({ ms: performance.now() - started, output, status }))
  })
  return { child, done }
}

const finishScan = async (scan: ActiveScan | undefined) => {
  if (!scan) {
    return 0
  }
  const { ms, output, status } = await scan.done
  console.log('\n▶ scan the image for fixable vulnerabilities (grype)')
  if (output.trim()) {
    console.log(output.trimEnd())
  }
  console.log(`  done in ${(ms / 1000).toFixed(1)}s`)
  return status
}

const appliedBy = (output: string) => {
  const last = JSON.parse(output.split('\n').at(-1) ?? '{}') as { applied?: number; msg?: string }
  if (last.msg !== 'migrations applied') {
    throw new Error(`the migrator's last log line is not {"msg":"migrations applied",...}. Its output:\n${output}`)
  }
  return last.applied
}

const migrateOnce = (...overrides: Array<string>) =>
  composeAsync(['run', '--rm', '--no-deps', ...overrides.flatMap((e) => ['--env', e]), 'migrate'])

const migrateConcurrently = async () => {
  const outputs = await Promise.all([1, 2, 3].map(() => migrateOnce()))
  for (const output of outputs) {
    console.log(`  pooled: ${output}`)
  }
  const applied = outputs.map((output) => appliedBy(output)).toSorted((a, b) => (a ?? 0) - (b ?? 0))
  if (applied.join() !== `0,0,${MIGRATIONS}`) {
    throw new Error(`expected one run to apply ${MIGRATIONS} migrations and two to apply none, got ${applied.join()}`)
  }
}

const migrateDirectly = async () => {
  const direct = await migrateOnce(`MIGRATION_DATABASE_URL=postgres://app:${env.APP_DB_PASSWORD}@db:5432/app`)
  console.log(`  direct: ${direct}`)
  const applied = appliedBy(direct)
  if (applied !== 0) {
    throw new Error(`the direct run applied ${applied} migration(s), expected 0`)
  }
  const query = "select count(*) from pg_locks where locktype = 'advisory'"
  const locks = compose(['exec', '-T', 'db', 'psql', '-U', 'postgres', '-d', 'app', '-Atc', query])
  if (locks !== '0') {
    throw new Error(`${locks} advisory lock(s) left behind on the pooler's server connections`)
  }
}

const account = { email: 'first@example.test', password: randomBytes(18).toString('base64url') }

const createFirstAccount = () => {
  const command = ['node', '.output/create-user.mjs', account.email, 'First User']
  console.log(`  ${compose(['run', '--rm', '--no-deps', '-T', 'app', ...command], `${account.password}\n`)}`)
}

const homeProblems = async (base: string): Promise<Array<string>> => {
  const problems: Array<string> = []
  const home = await fetch(base, { headers: { 'accept-encoding': 'gzip' } })
  await home.arrayBuffer()
  const encoding = home.headers.get('content-encoding')
  if (encoding !== 'gzip') {
    problems.push(`/ is not compressed by the edge (Content-Encoding ${encoding}, expected gzip)`)
  }
  if (home.headers.get('cache-control') !== 'private, no-store') {
    problems.push(
      `/ Cache-Control changed on the way: ${home.headers.get('cache-control')}, expected private, no-store (src/routes/index.tsx)`,
    )
  }
  return problems
}

const checkPages = async (base: string) => {
  const problems: Array<string> = []
  for (const path of ['/', '/about', '/login', '/api/health']) {
    const res = await fetch(base + path, { headers: { 'accept-encoding': 'gzip' } })
    await res.arrayBuffer()
    if (!res.ok) {
      problems.push(`${path}: ${res.status}`)
    }
  }
  problems.push(...(await homeProblems(base)))
  if (problems.length) {
    throw new Error(problems.join('; '))
  }
}

const signInAndReadPosts = async (base: string) => {
  const signIn = await fetch(`${base}/api/auth/sign-in/email`, {
    body: JSON.stringify(account),
    headers: { 'content-type': 'application/json', origin: ORIGIN },
    method: 'POST',
  })
  await signIn.arrayBuffer()
  const cookie = signIn.headers
    .getSetCookie()
    .map((c) => c.split(';', 1)[0])
    .join('; ')
  if (!signIn.ok || !cookie) {
    throw new Error(`sign-in answered ${signIn.status} ${cookie ? 'with' : 'without'} a cookie, expected 200 with one`)
  }
  const posts = await fetch(`${base}/api/me/posts`, { headers: { cookie } })
  const body = (await posts.json()) as { items?: Array<unknown> }
  if (!posts.ok || !Array.isArray(body.items)) {
    throw new Error(`GET /api/me/posts answered ${posts.status}, expected 200 with an \`items\` array`)
  }
}

const checkPermissionModel = () => {
  const logs = compose(['logs', '--no-log-prefix', 'app'])
  if (logs.includes('"permissionModel":true')) {
    return
  }
  const starting = logs.split('\n').find((line) => line.includes('"msg":"starting"')) ?? '(no such line)'
  throw new Error(`the "starting" log line does not say "permissionModel":true: ${starting}`)
}

const stopGracefully = () => {
  const started = performance.now()
  compose(['stop', 'app'])
  const ms = Math.round(performance.now() - started)
  const code = compose(['ps', '--all', '--format', '{{.ExitCode}}', 'app'])
  console.log(`  docker compose stop took ${ms} ms, exit code ${code}`)
  if (code !== '0' || ms >= MAX_STOP_MS) {
    throw new Error(`graceful stop failed: exit ${code} after ${ms} ms`)
  }
}

const cleanup = () => {
  spawnSync('docker', [...COMPOSE, 'down', '--volumes', '--remove-orphans'], { env, stdio: 'ignore' })
  if (process.env.KEEP_SMOKE_IMAGE !== '1') {
    spawnSync('docker', ['image', 'rm', IMAGE], { stdio: 'ignore' })
  }
}

let failed = false
let scanStatus: number | null
let activeScan: ActiveScan | undefined
process.once('SIGINT', () => {
  activeScan?.child.kill('SIGTERM')
  cleanup()
  process.exit(130)
})
try {
  await step(`build ${IMAGE}`, buildImage)
  activeScan = startScanImage()
  await step('start Postgres and PgBouncer (transaction mode)', () => compose(['up', '--detach', '--wait', 'pooler']))
  await step('migrate: three runs at once through the pooler', migrateConcurrently)
  await step('migrate: one direct run, which applies nothing', migrateDirectly)
  await step('create the first account with the bundled create-user', createFirstAccount)
  await step('bring the stack up (migrate, app, edge)', () => compose(['up', '--detach', '--wait']))
  const base = `http://${compose(['port', 'edge', '8080'])}`
  await step(`check pages through the edge at ${base}`, () => checkPages(base))
  await step('sign in as the first account through the edge and read its posts', () => signInAndReadPosts(base))
  await step("check that the server runs under Node's permission model", checkPermissionModel)
  await step('stop the app gracefully', stopGracefully)
} catch (error) {
  failed = true
  console.error(`\nFAIL ${error instanceof Error ? error.message : String(error)}`)
} finally {
  const logs = spawnSync('docker', [...COMPOSE, 'logs', '--no-color', ...(failed ? [] : ['app'])], {
    encoding: 'utf8',
    env,
  })
  console.log(`\n--- ${failed ? 'every service' : 'app'} logs ---\n${`${logs.stdout}${logs.stderr}`.trim()}`)
  scanStatus = await finishScan(activeScan)
  cleanup()
}
if (scanStatus !== 0) {
  failed = true
  console.error(
    `\nFAIL image scan (grype exit ${scanStatus}). Move to a base image digest with the fix (Renovate proposes it; ` +
      'by hand, the digest in scripts/images.ts and every copy `pnpm ci:workflows` lists), or add an ignore rule ' +
      'with its reason and a review date to .config/grype.yaml.',
  )
}
console.log(failed ? '\ndocker smoke test failed' : '\ndocker smoke test passed')
process.exitCode = failed ? 1 : 0
