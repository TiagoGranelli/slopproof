// Runs TLC over every TLA+ spec in specs/ that has a matching .cfg.
// Downloads a pinned tla2tools.jar with SHA-256 verification into ~/.cache/tla2tools (never committed).
// Uses native `java` when available, otherwise falls back to a pinned JRE container via Docker.
// Usage: pnpm verify:tla [spec-name ...]
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join, resolve } from 'node:path'

const TLA_VERSION = 'v1.7.4'
const TLA_JAR_URL = `https://github.com/tlaplus/tlaplus/releases/download/${TLA_VERSION}/tla2tools.jar`
const TLA_JAR_SHA256 = '936a262061c914694dfd669a543be24573c45d5aa0ff20a8b96b23d01e050e88'
const JRE_IMAGE =
  'eclipse-temurin:21-jre-alpine@sha256:ac05c3c42b7c2f1a52c9bd52f01041fa1958231b15ebeae7420429cbc5baf474'

const CACHE_DIR = join(homedir(), '.cache', 'tla2tools', TLA_VERSION)
const CACHE_JAR = join(CACHE_DIR, 'tla2tools.jar')
const SPECS_DIR = resolve('specs')

type RuntimeKind = 'docker' | 'java'

interface StateCounts {
  readonly distinctStates: string
  readonly generatedStates: string
}

interface SpecOutcome extends StateCounts {
  readonly durationSeconds: string
  readonly name: string
  readonly ok: boolean
}

const sha256File = (path: string): string => createHash('sha256').update(readFileSync(path)).digest('hex')

const ensureJar = async (): Promise<string> => {
  if (existsSync(CACHE_JAR) && sha256File(CACHE_JAR) === TLA_JAR_SHA256) {
    return CACHE_JAR
  }
  mkdirSync(CACHE_DIR, { recursive: true })
  const response = await fetch(TLA_JAR_URL)
  if (!response.ok) {
    throw new Error(`Failed to download ${TLA_JAR_URL} (status ${response.status})`)
  }
  const bytes = Buffer.from(await response.arrayBuffer())
  const digest = createHash('sha256').update(bytes).digest('hex')
  if (digest !== TLA_JAR_SHA256) {
    throw new Error(`tla2tools.jar SHA-256 mismatch: expected ${TLA_JAR_SHA256}, got ${digest}`)
  }
  writeFileSync(CACHE_JAR, bytes)
  return CACHE_JAR
}

const hasCommand = (cmd: string, args: ReadonlyArray<string>): boolean =>
  spawnSync(cmd, args, { stdio: 'ignore' }).status === 0

const detectRuntime = (): RuntimeKind => {
  if (hasCommand('java', ['-version'])) {
    return 'java'
  }
  if (hasCommand('docker', ['info'])) {
    return 'docker'
  }
  throw new Error('Neither `java` nor a running `docker` daemon is available to run TLC.')
}

const discoverSpecs = (filters: ReadonlyArray<string>): Array<string> => {
  const specs = readdirSync(SPECS_DIR)
    .filter((file) => file.endsWith('.tla'))
    .map((file) => basename(file, '.tla'))
    .filter((name) => existsSync(join(SPECS_DIR, `${name}.cfg`)))
    .toSorted()
  return filters.length === 0 ? specs : specs.filter((name) => filters.includes(name))
}

const parseStates = (output: string): StateCounts => {
  const match = /(\d[\d,]*) states generated,\s*(\d[\d,]*) distinct states found/.exec(output)
  return { distinctStates: match?.[2] ?? '?', generatedStates: match?.[1] ?? '?' }
}

const buildTlcArgs = (runtime: RuntimeKind, jarPath: string, paths: { metaDir: string; specName: string }) => [
  '-XX:+UseParallelGC',
  '-cp',
  runtime === 'docker' ? '/tla/tla2tools.jar' : jarPath,
  'tlc2.TLC',
  '-workers',
  'auto',
  '-cleanup',
  '-metadir',
  runtime === 'docker' ? '/meta' : paths.metaDir,
  '-config',
  `${paths.specName}.cfg`,
  `${paths.specName}.tla`,
]

const dockerTlcArgs = (metaDir: string, tlcArgs: ReadonlyArray<string>): Array<string> => [
  'run',
  '--rm',
  '-v',
  `${SPECS_DIR}:/specs:ro`,
  '-v',
  `${CACHE_DIR}:/tla:ro`,
  '-v',
  `${metaDir}:/meta`,
  '-w',
  '/specs',
  JRE_IMAGE,
  'java',
  ...tlcArgs,
]

const spawnTlc = (runtime: RuntimeKind, metaDir: string, tlcArgs: ReadonlyArray<string>) =>
  runtime === 'docker'
    ? spawnSync('docker', dockerTlcArgs(metaDir, tlcArgs), { encoding: 'utf8' })
    : spawnSync('java', tlcArgs, { cwd: SPECS_DIR, encoding: 'utf8' })

const runTlc = (runtime: RuntimeKind, jarPath: string, specName: string): SpecOutcome => {
  const started = performance.now()
  const metaDir = mkdtempSync(join(CACHE_DIR, 'meta-'))
  const exec = spawnTlc(runtime, metaDir, buildTlcArgs(runtime, jarPath, { metaDir, specName }))
  rmSync(metaDir, { force: true, recursive: true })
  const output = `${exec.stdout}\n${exec.stderr}`
  const durationSeconds = ((performance.now() - started) / 1000).toFixed(2)
  const { distinctStates, generatedStates } = parseStates(output)
  const ok = exec.status === 0 && output.includes('Model checking completed. No error has been found.')
  if (!ok) {
    console.error(output)
  }
  return { distinctStates, durationSeconds, generatedStates, name: specName, ok }
}

const main = async (): Promise<void> => {
  const runtime = detectRuntime()
  const jarPath = await ensureJar()
  const specs = discoverSpecs(process.argv.slice(2))
  if (specs.length === 0) {
    throw new Error(`No matching .tla/.cfg pairs found in ${SPECS_DIR}`)
  }
  console.log(`Running TLC (${TLA_VERSION}, runtime: ${runtime}) on ${specs.length} spec(s)...`)
  const outcomes = specs.map((specName) => runTlc(runtime, jarPath, specName))
  for (const outcome of outcomes) {
    const label = outcome.ok ? 'ok  ' : 'FAIL'
    console.log(
      `${label}  ${outcome.name.padEnd(20)} ${outcome.distinctStates} distinct / ${outcome.generatedStates} generated (${outcome.durationSeconds}s)`,
    )
  }
  process.exitCode = outcomes.every((outcome) => outcome.ok) ? 0 : 1
}

await main()
