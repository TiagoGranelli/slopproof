import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { IMAGES } from './images.ts'
import { captureProcess } from './process-log.ts'
import type { ProcessOutput } from './process-log.ts'

type TomlScalar = boolean | number | string
type TomlTable = Record<string, TomlScalar>

type ParsedFlyToml = {
  arrays: Record<string, Array<TomlTable>>
  errors: Array<string>
  root: TomlTable
  tables: Record<string, TomlTable>
}

type ParserState = {
  parsed: ParsedFlyToml
  target: TomlTable
}

type CaddyValidateCommand = {
  args: Array<string>
  command: string
  env: Record<string, string>
}

const DEFAULT_CADDYFILE = 'deploy/Caddyfile'
const DEFAULT_FLY_TOML = 'deploy/fly.toml'
const SECTION_PATTERN = /^[A-Za-z0-9_.-]+$/
const KEY_PATTERN = /^[A-Za-z0-9_-]+$/

const DUMMY_EDGE_ENV = {
  EDGE_ADDRESS: 'https://app.example.com',
  EDGE_HTTP_PORT: '80',
  EDGE_TRUSTED_PROXIES: '10.0.0.0/8',
  EDGE_UPSTREAM: 'app:3000',
} as const satisfies Record<string, string>

const DOCKER_SANDBOX = [
  'run',
  '--rm',
  '--network',
  'none',
  '--memory',
  '256m',
  '--read-only',
  '--tmpfs',
  '/data',
  '--tmpfs',
  '/config',
]

const CADDY_VALIDATE_ARGS = ['validate', '--config', '/etc/caddy/Caddyfile', '--adapter', 'caddyfile']

const findCommentStart = (line: string): number => {
  let quote = ''
  for (let index = 0; index < line.length; index++) {
    const char = line[index] ?? ''
    if (quote === '"' && char === '\\') {
      index += 1
      continue
    }
    if (!quote && char === '#') {
      return index
    }
    if (char === '"' || char === "'") {
      quote = quote === char ? '' : quote || char
    }
  }
  return line.length
}

const stripTomlComment = (line: string): string => line.slice(0, findCommentStart(line)).trim()

const parseQuotedString = (raw: string): string | undefined => {
  if (raw.length < 2) {
    return undefined
  }
  if (raw.startsWith("'") && raw.endsWith("'")) {
    const inner = raw.slice(1, -1)
    return inner.includes("'") ? undefined : inner
  }
  if (!raw.startsWith('"') || !raw.endsWith('"')) {
    return undefined
  }
  try {
    return JSON.parse(raw) as string
  } catch {
    return undefined
  }
}

const parseTomlScalar = (raw: string): TomlScalar | undefined => {
  if (raw === 'true' || raw === 'false') {
    return raw === 'true'
  }
  if (/^[+-]?\d+(?:\.\d+)?$/.test(raw)) {
    return Number(raw)
  }
  return parseQuotedString(raw)
}

const selectArrayTable = (parsed: ParsedFlyToml, section: string, lineNumber: number): TomlTable | undefined => {
  if (!SECTION_PATTERN.test(section)) {
    parsed.errors.push(`line ${lineNumber}: invalid array table header "[[${section}]]"`)
    return undefined
  }
  const entry: TomlTable = {}
  const list = parsed.arrays[section] ?? []
  list.push(entry)
  parsed.arrays[section] = list
  return entry
}

const selectNamedTable = (parsed: ParsedFlyToml, section: string, lineNumber: number): TomlTable | undefined => {
  if (!SECTION_PATTERN.test(section)) {
    parsed.errors.push(`line ${lineNumber}: invalid table header "[${section}]"`)
    return undefined
  }
  const existing = parsed.tables[section] ?? {}
  parsed.tables[section] = existing
  return existing
}

const applyHeader = (state: ParserState, cleaned: string, lineNumber: number): void => {
  if (cleaned.startsWith('[[') && cleaned.endsWith(']]')) {
    const next = selectArrayTable(state.parsed, cleaned.slice(2, -2).trim(), lineNumber)
    if (next) {
      state.target = next
    }
    return
  }
  const next = selectNamedTable(state.parsed, cleaned.slice(1, -1).trim(), lineNumber)
  if (next) {
    state.target = next
  }
}

const applyAssignment = (state: ParserState, cleaned: string, lineNumber: number): void => {
  const equals = cleaned.indexOf('=')
  const key = equals > 0 ? cleaned.slice(0, equals).trim() : ''
  const rawValue = equals > 0 ? cleaned.slice(equals + 1).trim() : ''
  const parsedValue = KEY_PATTERN.test(key) ? parseTomlScalar(rawValue) : undefined
  if (parsedValue === undefined) {
    state.parsed.errors.push(`line ${lineNumber}: invalid assignment "${cleaned}"`)
    return
  }
  state.target[key] = parsedValue
}

export const parseFlyToml = (source: string): ParsedFlyToml => {
  const parsed: ParsedFlyToml = { arrays: {}, errors: [], root: {}, tables: {} }
  const state: ParserState = { parsed, target: parsed.root }
  const lines = source.split(/\r?\n/)
  for (let index = 0; index < lines.length; index++) {
    const cleaned = stripTomlComment(lines[index] ?? '')
    if (!cleaned) {
      continue
    }
    if (cleaned.startsWith('[') && cleaned.endsWith(']')) {
      applyHeader(state, cleaned, index + 1)
    } else {
      applyAssignment(state, cleaned, index + 1)
    }
  }
  return parsed
}

const formatGot = (value: TomlScalar | undefined): string => (value === undefined ? 'missing' : JSON.stringify(value))

const hasReadyHealthcheck = (checks: ReadonlyArray<TomlTable> | undefined): boolean =>
  (checks ?? []).some((check) => check.path === '/api/ready')

const hasNonEmptyString = (value: TomlScalar | undefined): boolean =>
  typeof value === 'string' && value.trim().length > 0

const validateFlyServiceAndEnv = (parsed: ParsedFlyToml): Array<string> => {
  const problems: Array<string> = []
  const forceHttps = parsed.tables.http_service?.force_https
  if (forceHttps !== true) {
    problems.push(`deploy/fly.toml: [http_service].force_https must be true (got ${formatGot(forceHttps)})`)
  }
  if (!hasReadyHealthcheck(parsed.arrays['http_service.checks'])) {
    problems.push('deploy/fly.toml: [[http_service.checks]] must define a healthcheck with path = "/api/ready"')
  }
  const trustedProxies = parsed.tables.env?.TRUSTED_PROXIES
  if (!hasNonEmptyString(trustedProxies)) {
    problems.push(
      `deploy/fly.toml: [env].TRUSTED_PROXIES must be a non-empty string (got ${formatGot(trustedProxies)})`,
    )
  }
  return problems
}

export const validateFlyToml = (source: string): Array<string> => {
  const parsed = parseFlyToml(source)
  if (parsed.errors.length > 0) {
    return parsed.errors.map((error) => `deploy/fly.toml ${error}`)
  }
  const problems: Array<string> = []
  if (parsed.root.kill_signal !== 'SIGTERM') {
    problems.push(`deploy/fly.toml: kill_signal must be "SIGTERM" (got ${formatGot(parsed.root.kill_signal)})`)
  }
  const releaseCommand = parsed.tables.deploy?.release_command
  if (releaseCommand !== 'node .output/migrate.mjs') {
    problems.push(
      `deploy/fly.toml: [deploy].release_command must be "node .output/migrate.mjs" (got ${formatGot(releaseCommand)})`,
    )
  }
  return [...problems, ...validateFlyServiceAndEnv(parsed)]
}

export const buildCaddyValidateCommand = (
  caddyfilePath = DEFAULT_CADDYFILE,
  caddyBin = process.env.CADDY_BIN,
): CaddyValidateCommand => {
  const resolvedPath = resolve(caddyfilePath)
  if (caddyBin) {
    return {
      args: ['validate', '--config', resolvedPath, '--adapter', 'caddyfile'],
      command: caddyBin,
      env: { ...DUMMY_EDGE_ENV },
    }
  }
  const envFlags = Object.entries(DUMMY_EDGE_ENV).flatMap(([key, value]) => ['--env', `${key}=${value}`])
  const mount = ['--volume', `${resolvedPath}:/etc/caddy/Caddyfile:ro`]
  return {
    args: [...DOCKER_SANDBOX, ...mount, ...envFlags, IMAGES.caddy, 'caddy', ...CADDY_VALIDATE_ARGS],
    command: 'docker',
    env: {},
  }
}

export const validateCaddyfile = (
  caddyfilePath = DEFAULT_CADDYFILE,
  caddyBin = process.env.CADDY_BIN,
): Promise<ProcessOutput> => {
  const { args, command, env } = buildCaddyValidateCommand(caddyfilePath, caddyBin)
  return captureProcess(command, args, { ...process.env, ...env })
}

const runCli = async (): Promise<number> => {
  const caddy = await validateCaddyfile(DEFAULT_CADDYFILE)
  const flyProblems = validateFlyToml(readFileSync(DEFAULT_FLY_TOML, 'utf8'))
  if (caddy.status !== 0) {
    console.error(`FAIL  ${DEFAULT_CADDYFILE}\n${caddy.output.trim()}`)
  } else {
    console.log(`ok    ${DEFAULT_CADDYFILE}`)
  }
  if (flyProblems.length > 0) {
    console.error(`FAIL  ${DEFAULT_FLY_TOML}\n${flyProblems.join('\n')}`)
  } else {
    console.log(`ok    ${DEFAULT_FLY_TOML}`)
  }
  return caddy.status === 0 && flyProblems.length === 0 ? 0 : 1
}

if (import.meta.main) {
  process.exitCode = await runCli()
}
