import { existsSync, readFileSync } from 'node:fs'
import { delimiter, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { xSync } from 'tinyexec'

export type EditedFileKind = 'code' | 'format-only' | 'ignore' | 'migration'
export type GuardFinding = { line: number; message: string }
export type HookResponse =
  | { decision: 'block'; reason: string }
  | { hookSpecificOutput: { additionalContext: string; hookEventName: 'PostToolUse' } }

const CODE_EXT = /\.(?:ts|tsx|mts|js|mjs|cjs)$/
const FORMAT_EXT = /\.(?:ts|tsx|mts|js|mjs|cjs|json|jsonc|css|yml|yaml|html|toml)$/
const MIGRATION_FILE = /^drizzle\/[^/]+\.sql$/
const NEXT_LINE_DIRECTIVE =
  /^\s*\/\/\s*(?:oxlint-disable-next-line\b|fallow-ignore-next-line\b|@ts-expect-error\b|@effect-diagnostics\b|v8 ignore\b|oxfmt-ignore\b)/
const STANDALONE_DIRECTIVE = /^\s*\/\/\s*(?:fallow-ignore-file\b|\/\s*<reference\b)/
const ALLOWED_BLOCK = /(?:@effect-(?:expect-leaking|diagnostics)|oxlint-disable|v8 ignore|@vite-ignore)\b/
const ESLINT_DISABLE = /^\s*(?:\/\/|\/\*)\s*eslint-disable\b/
const TIMER_TOKEN = /\b(setTimeout|setInterval|requestAnimationFrame|requestIdleCallback)\b/
const DOUBLE_CAST = /\bas\s+unknown\s+as\b/
const OXLINT_ARGS = ['--deny-warnings', '--format=agent', '-A', 'no-unused-vars', '--no-error-on-unmatched-pattern']

const OXFMT_IGNORED_PREFIXES = [
  'node_modules/',
  '.output/',
  '.nitro/',
  '.tanstack/',
  '.fallow/',
  'drizzle/',
  '.repos/',
  'src/sdk/',
  '.agents/skills/',
  '.claude/',
]
const OXFMT_IGNORED_EXACT = new Set(['openapi.json', 'pnpm-lock.yaml', 'skills-lock.json', 'src/routeTree.gen.ts'])

const OXLINT_IGNORED_PREFIXES = [
  ...OXFMT_IGNORED_PREFIXES,
  '.agents/',
  'coverage/',
  'lighthouse-report/',
  'playwright-report/',
  'test-results/',
]

const hasPrefix = (file: string, prefixes: ReadonlyArray<string>): boolean =>
  prefixes.some((prefix) => file.startsWith(prefix))

export const parseSquawkExcludedPaths = (toml: string): ReadonlySet<string> => {
  const block = /excluded_paths\s*=\s*\[([\s\S]*?)\]/.exec(toml)
  if (!block?.[1]) {
    return new Set()
  }
  return new Set([...block[1].matchAll(/"([^"]+)"/g)].flatMap((entry) => (entry[1] ? [entry[1]] : [])))
}

export const loadExcludedMigrations = (root: string): ReadonlySet<string> => {
  const configPath = join(root, '.config', 'squawk.toml')
  return existsSync(configPath) ? parseSquawkExcludedPaths(readFileSync(configPath, 'utf8')) : new Set()
}

export const binEnv = (root: string): NodeJS.ProcessEnv => ({
  ...process.env,
  NO_COLOR: '1',
  PATH: `${join(root, 'node_modules', '.bin')}${delimiter}${process.env.PATH ?? ''}`,
})

export const isEntrypoint = (metaUrl: string): boolean => {
  const entry = process.argv[1]
  return entry !== undefined && resolve(entry) === fileURLToPath(metaUrl)
}

export const isFormatTarget = (file: string): boolean =>
  FORMAT_EXT.test(file) && !OXFMT_IGNORED_EXACT.has(file) && !hasPrefix(file, OXFMT_IGNORED_PREFIXES)

export const isLintTarget = (file: string): boolean =>
  CODE_EXT.test(file) && file !== 'src/routeTree.gen.ts' && !hasPrefix(file, OXLINT_IGNORED_PREFIXES)

export const isActiveMigration = (file: string, excludedMigrations: ReadonlySet<string>): boolean =>
  MIGRATION_FILE.test(file) && !excludedMigrations.has(file)

export const classifyEditedFile = (file: string, excludedMigrations: ReadonlySet<string>): EditedFileKind => {
  if (file === '' || file.startsWith('..')) {
    return 'ignore'
  }
  if (isActiveMigration(file, excludedMigrations)) {
    return 'migration'
  }
  if (isLintTarget(file)) {
    return 'code'
  }
  return isFormatTarget(file) ? 'format-only' : 'ignore'
}

export const followUpHintForFile = (file: string): string | undefined => {
  if (file.startsWith('src/contract/')) {
    return 'Contract changed: run `pnpm codegen` to update openapi.json and src/sdk, then `pnpm check:changed`.'
  }
  if (file.startsWith('src/server/db/schema/')) {
    return 'DB schema changed: run `pnpm db:generate --name <slug>` and `pnpm check:drift migrations auth`.'
  }
  if (file === 'src/server/auth.ts') {
    return 'Better Auth config changed: verify schema parity with `pnpm check:drift auth`.'
  }
  if (MIGRATION_FILE.test(file)) {
    return 'Migration edited: verify with `pnpm check:migrations` and `pnpm check:drift migrations`.'
  }
  return file === 'package.json'
    ? 'Dependencies changed: keep exact versions and run `pnpm licenses:check`.'
    : undefined
}

const isReasonComment = (line: string): boolean =>
  /^\s*\/\/\s*\S/.test(line) && !NEXT_LINE_DIRECTIVE.test(line) && !STANDALONE_DIRECTIVE.test(line)

const isValidSlashComment = (lines: ReadonlyArray<string>, index: number): boolean => {
  const line = lines[index] ?? ''
  if (STANDALONE_DIRECTIVE.test(line)) {
    return true
  }
  const previous = lines[index - 1] ?? ''
  const next = lines[index + 1] ?? ''
  return (
    (NEXT_LINE_DIRECTIVE.test(line) && isReasonComment(previous)) ||
    (isReasonComment(line) && NEXT_LINE_DIRECTIVE.test(next))
  )
}

const ADR19_MESSAGE =
  'Comment violates ADR 0019 (repo/no-comments). Remove it or anchor to a machine-checked directive.'
const ESLINT_DISABLE_MESSAGE =
  'Use `// oxlint-disable-next-line <rule>` with a 1-line reason above it instead of `eslint-disable`.'

const inspectCommentLine = (lines: ReadonlyArray<string>, index: number): GuardFinding | undefined => {
  const line = lines[index] ?? ''
  if (ESLINT_DISABLE.test(line)) {
    return { line: index + 1, message: ESLINT_DISABLE_MESSAGE }
  }
  if (/^\s*\/\*/.test(line) && !ALLOWED_BLOCK.test(lines.slice(index, index + 6).join('\n'))) {
    return { line: index + 1, message: ADR19_MESSAGE }
  }
  if (!/^\s*\/\//.test(line) || isValidSlashComment(lines, index)) {
    return undefined
  }
  return { line: index + 1, message: ADR19_MESSAGE }
}

const inspectSrcTokenLine = (lines: ReadonlyArray<string>, index: number): GuardFinding | undefined => {
  const line = lines[index] ?? ''
  const previous = lines[index - 1] ?? ''
  if (/^\s*\/\//.test(line) || /^\s*\/\/\s*oxlint-disable-next-line\b/.test(previous)) {
    return undefined
  }
  if (DOUBLE_CAST.test(line)) {
    return {
      line: index + 1,
      message: '`as unknown as` is banned in src/. Decode with Effect Schema or fix the source type.',
    }
  }
  const timer = TIMER_TOKEN.exec(line)?.[1]
  return timer
    ? {
        line: index + 1,
        message: `\`${timer}\` is banned in src/ (ADR 0017). Derive state, use event handlers, ref callbacks, or Effect Clock/Schedule.`,
      }
    : undefined
}

export const inspectEditedSource = (file: string, content: string): Array<GuardFinding> => {
  const lines = content.split('\n')
  const checkSrc = file.startsWith('src/')
  const findings: Array<GuardFinding> = []
  for (let index = 0; index < lines.length; index++) {
    const commentFinding = inspectCommentLine(lines, index)
    if (commentFinding) {
      findings.push(commentFinding)
    }
    const tokenFinding = checkSrc ? inspectSrcTokenLine(lines, index) : undefined
    if (tokenFinding) {
      findings.push(tokenFinding)
    }
  }
  return findings
}

const runTool = (root: string, tool: string, args: Array<string>) => {
  const run = xSync(tool, args, { nodeOptions: { cwd: root, env: binEnv(root) } })
  return { output: `${run.stdout}${run.stderr}`.trim(), status: run.exitCode ?? 1 }
}

const blockResponse = (output: string, fixHint: string): HookResponse => ({
  decision: 'block',
  reason: `${output}\n\n${fixHint}`,
})

const hintResponse = (file: string): HookResponse | undefined => {
  const hint = followUpHintForFile(file)
  return hint ? { hookSpecificOutput: { additionalContext: hint, hookEventName: 'PostToolUse' } } : undefined
}

const checkCodeFile = (root: string, file: string): HookResponse | undefined => {
  const formatted = runTool(root, 'oxfmt', ['--no-error-on-unmatched-pattern', file])
  if (formatted.status !== 0) {
    return blockResponse(formatted.output, `Fix syntax/formatting in ${file} (or run \`pnpm format\`).`)
  }
  const findings = inspectEditedSource(file, readFileSync(join(root, file), 'utf8'))
  if (findings.length > 0) {
    const report = findings.map(({ line, message }) => `${file}:${line}: ${message}`).join('\n')
    return blockResponse(report, `Fix in ${file} and re-verify with \`pnpm lint ${file}\`.`)
  }
  const linted = runTool(root, 'oxlint', [...OXLINT_ARGS, file])
  return linted.status === 0
    ? hintResponse(file)
    : blockResponse(linted.output, `Fix in ${file} (or run \`pnpm lint:fix ${file}\`).`)
}

const evaluateEditedFile = (root: string, filePath: string): HookResponse | undefined => {
  const file = relative(root, filePath).split(sep).join('/')
  const kind = classifyEditedFile(file, loadExcludedMigrations(root))
  if (kind === 'ignore' || !existsSync(join(root, file))) {
    return undefined
  }
  if (kind === 'migration') {
    const squawked = runTool(root, 'squawk', ['--config', '.config/squawk.toml', file])
    return squawked.status === 0
      ? hintResponse(file)
      : blockResponse(squawked.output, `Fix migration ${file} (verify with \`pnpm check:migrations\`).`)
  }
  if (kind === 'format-only') {
    const formatted = runTool(root, 'oxfmt', ['--no-error-on-unmatched-pattern', file])
    return formatted.status === 0
      ? hintResponse(file)
      : blockResponse(formatted.output, `Fix formatting in ${file} (or run \`pnpm format\`).`)
  }
  return checkCodeFile(root, file)
}

if (isEntrypoint(import.meta.url)) {
  const root = join(import.meta.dirname, '..')
  const payload = JSON.parse(readFileSync(0, 'utf8')) as { tool_input?: { file_path?: string } }
  const response = payload.tool_input?.file_path ? evaluateEditedFile(root, payload.tool_input.file_path) : undefined
  if (response) {
    console.log(JSON.stringify(response))
  }
}
