import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { availableParallelism, tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs as parseNodeArgs } from 'node:util'
import { x } from 'tinyexec'

export type Mutant = {
  column: number
  file: string
  id: number
  line: number
  mutated: string
  operator: string
  original: string
  source: string
}
export type MutantOutcome = { durationMs: number; killed: boolean; mutant: Mutant }
export type FileReport = {
  file: string
  killed: number
  score: number
  survived: Array<Mutant>
  threshold: number
  total: number
}
export type CliOptions = { changed: boolean; concurrency: number; files: Array<string>; json: boolean; since?: string }
export type RelatedTests = { files: Array<string>; projects: Array<string> }

type OperatorRule = readonly [from: string, to: string, name: string]
type RunContext = { concurrency: number; configPath: string; workDir: string }

const BINARY_RULES: ReadonlyArray<OperatorRule> = [
  ['===', '!==', 'equality'],
  ['!==', '===', 'equality'],
  ['&&', '||', 'logical'],
  ['||', '&&', 'logical'],
  ['??', '||', 'nullish'],
  ['<=', '<', 'relational'],
  ['>=', '>', 'relational'],
  ['?.', '.', 'optional-chain'],
]
const THRESHOLD_90 = new Set([
  'src/features/auth/utils/describe-session.ts',
  'src/features/auth/utils/safe-redirect.ts',
])
const SKIP_LINE = /^(?:import\b|export\s+type\b|type\s+\w|interface\s+\w)/
const IDENT_CHAR = /[\w$]/

const normalizePath = (file: string): string => file.replaceAll('\\', '/').replace(/^\.\//, '')

export const parseCoverageGate = (configText: string): Array<string> => {
  const block = /const COVERAGE_GATE = \[([\s\S]*?)\]/.exec(configText)?.[1] ?? ''
  return [...block.matchAll(/'([^']+)'/g)].flatMap((match) => (match[1] ? [match[1]] : []))
}

export const thresholdForFile = (file: string, gateFiles: ReadonlyArray<string>): number => {
  const normalized = normalizePath(file)
  if (THRESHOLD_90.has(normalized)) {
    return 90
  }
  return gateFiles.includes(normalized) ? 100 : 80
}

const skipString = (source: string, start: number, quote: string): number => {
  for (let cursor = start + 1; cursor < source.length; cursor += 1) {
    if (source[cursor] === '\\') {
      cursor += 1
    } else if (source[cursor] === quote) {
      return cursor + 1
    }
  }
  return source.length
}

const isWordAt = (source: string, index: number, word: string): boolean =>
  source.startsWith(word, index) &&
  !IDENT_CHAR.test(source[index - 1] ?? '') &&
  !IDENT_CHAR.test(source[index + word.length] ?? '')

const matchAt = (source: string, index: number): OperatorRule | undefined => {
  const binary = BINARY_RULES.find(([from]) => source.startsWith(from, index))
  if (binary) {
    return binary
  }
  if (isWordAt(source, index, 'true') || isWordAt(source, index, 'false')) {
    return source[index] === 't' ? ['true', 'false', 'boolean'] : ['false', 'true', 'boolean']
  }
  const ch = source[index]
  const prev = source[index - 1] ?? ''
  const next = source[index + 1] ?? ''
  if ((ch === '<' || ch === '>') && prev === ' ' && next === ' ') {
    return [ch, `${ch}=`, 'relational']
  }
  return ch === '!' && next !== '=' && !/[\w$)\]]/.test(prev) && /[A-Za-z_(]/.test(next)
    ? ['!', '', 'unary-negate']
    : undefined
}

const nextScanIndex = (source: string, index: number): number | undefined => {
  const current = source[index]
  if (current === "'" || current === '"' || current === '`') {
    return skipString(source, index, current)
  }
  const lineHead = source.slice(source.lastIndexOf('\n', index - 1) + 1, index).trim()
  if ((index === 0 || lineHead === '') && SKIP_LINE.test(source.slice(index))) {
    const newline = source.indexOf('\n', index)
    return newline === -1 ? source.length : newline + 1
  }
  return undefined
}

const buildMutant = (file: string, source: string, spec: { id: number; index: number; rule: OperatorRule }): Mutant => {
  const [from, to, operator] = spec.rule
  const lines = source.slice(0, spec.index).split('\n')
  return {
    column: (lines.at(-1)?.length ?? 0) + 1,
    file,
    id: spec.id,
    line: lines.length,
    mutated: to || '(removed)',
    operator,
    original: from,
    source: `${source.slice(0, spec.index)}${to}${source.slice(spec.index + from.length)}`,
  }
}

export const generateMutants = (file: string, source: string): Array<Mutant> => {
  const mutants: Array<Mutant> = []
  let index = 0
  while (index < source.length) {
    const skipped = nextScanIndex(source, index)
    if (skipped !== undefined) {
      index = skipped
      continue
    }
    const rule = matchAt(source, index)
    if (rule) {
      mutants.push(buildMutant(file, source, { id: mutants.length + 1, index, rule }))
    }
    index += rule ? rule[0].length : 1
  }
  return mutants
}

export const scoreMutants = (file: string, outcomes: ReadonlyArray<MutantOutcome>, threshold: number): FileReport => {
  const total = outcomes.length
  const killed = outcomes.filter((e) => e.killed).length
  const survived = outcomes.flatMap((e) => (e.killed ? [] : [e.mutant]))
  return {
    file,
    killed,
    score: total === 0 ? 100 : Math.round((killed / total) * 1000) / 10,
    survived,
    threshold,
    total,
  }
}

const testCandidates = (dir: string): Array<string> =>
  existsSync(dir)
    ? readdirSync(dir, { encoding: 'utf8', recursive: true }).flatMap((entry) =>
        entry.endsWith('.test.ts') ? [normalizePath(join(dir, entry))] : [],
      )
    : []

export const findRelatedTests = (targetFile: string): RelatedTests => {
  const normalized = normalizePath(targetFile)
  const alias = normalized.startsWith('src/') ? `#/${normalized.slice(4)}` : normalized
  const stem = basename(normalized, '.ts')
  const matched = [...testCandidates('tests/unit'), ...testCandidates('tests/api')].filter(
    (c) => readFileSync(c, 'utf8').includes(alias) || c.endsWith(`/${stem}.test.ts`),
  )
  return { files: matched, projects: [...new Set(matched.map((p) => (p.startsWith('tests/api/') ? 'api' : 'unit')))] }
}

const gitChangedFiles = (since?: string): Array<string> =>
  spawnSync('git', ['diff', '--name-only', since ?? 'HEAD', '--', 'src'], { encoding: 'utf8' })
    .stdout.split('\n')
    .flatMap((line) => {
      const f = normalizePath(line.trim())
      return f.endsWith('.ts') && existsSync(f) ? [f] : []
    })

export const parseArgs = (argv: ReadonlyArray<string>): CliOptions => {
  const { values } = parseNodeArgs({
    args: [...argv],
    options: {
      changed: { default: false, type: 'boolean' },
      concurrency: { type: 'string' },
      file: { multiple: true, type: 'string' },
      json: { default: false, type: 'boolean' },
      since: { type: 'string' },
    },
  })
  return {
    changed: values.changed,
    concurrency: values.concurrency ? Math.max(1, Number(values.concurrency)) : Math.min(4, availableParallelism()),
    files: (values.file ?? []).map((entry) => normalizePath(entry)),
    json: values.json,
    since: values.since,
  }
}

const writeMutateConfig = (workDir: string): string => {
  const configPath = join(workDir, 'vitest.mutate.config.mjs')
  const script = [
    "import { readFileSync } from 'node:fs'",
    `import base from '${pathToFileURL(resolve('vitest.config.ts')).href}'`,
    "const mutatePlugin = { enforce: 'pre', load(id) { const clean = id.split('?')[0]; return process.env.MUTATE_TARGET && clean === process.env.MUTATE_TARGET && process.env.MUTATE_PATCH ? readFileSync(process.env.MUTATE_PATCH, 'utf8') : null }, name: 'mutate-override' }",
    'export default { ...base, plugins: [mutatePlugin, ...(base.plugins ?? [])] }',
  ].join('\n')
  writeFileSync(configPath, script)
  return configPath
}

const runVitest = async (configPath: string, related: RelatedTests, env: Record<string, string>) =>
  (
    await x(
      'vitest',
      [
        'run',
        '--config',
        configPath,
        '--no-cache',
        '--no-fsModuleCache',
        '--bail',
        '1',
        ...related.projects.flatMap((p) => ['--project', p]),
        ...related.files,
      ],
      { nodeOptions: { env: { ...process.env, ...env } } },
    )
  ).exitCode ?? 1

const runMutantPool = async (
  mutants: ReadonlyArray<Mutant>,
  concurrency: number,
  run: (m: Mutant) => Promise<MutantOutcome>,
): Promise<Array<MutantOutcome>> => {
  const queue = [...mutants]
  const outcomes: Array<MutantOutcome> = []
  const worker = async () => {
    for (let next = queue.shift(); next; next = queue.shift()) {
      outcomes.push(await run(next))
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(1, mutants.length)) }, worker))
  return outcomes.toSorted((left, right) => left.mutant.id - right.mutant.id)
}

const evaluateFile = async (file: string, gateFiles: ReadonlyArray<string>, ctx: RunContext): Promise<FileReport> => {
  const related = findRelatedTests(file)
  if (related.files.length === 0) {
    throw new Error(`No related unit/api test found for ${file}`)
  }
  if ((await runVitest(ctx.configPath, related, { MUTATE_PATCH: '', MUTATE_TARGET: '' })) !== 0) {
    throw new Error(`Baseline tests failed for ${file} (${related.files.join(', ')})`)
  }
  const targetAbs = resolve(file)
  const mutants = generateMutants(file, readFileSync(file, 'utf8'))
  const outcomes = await runMutantPool(mutants, ctx.concurrency, async (mutant) => {
    const started = performance.now()
    const patchPath = join(ctx.workDir, `m-${mutant.id}.ts`)
    writeFileSync(patchPath, mutant.source)
    const exitCode = await runVitest(ctx.configPath, related, { MUTATE_PATCH: patchPath, MUTATE_TARGET: targetAbs })
    return { durationMs: Math.round(performance.now() - started), killed: exitCode !== 0, mutant }
  })
  return scoreMutants(file, outcomes, thresholdForFile(file, gateFiles))
}

const printReport = (reports: ReadonlyArray<FileReport>, json: boolean): void => {
  if (json) {
    console.log(JSON.stringify(reports, null, 2))
    return
  }
  for (const r of reports) {
    const tag = r.score >= r.threshold ? 'PASS' : 'FAIL'
    console.log(`${tag}  ${r.file}: ${r.killed}/${r.total} killed (${r.score}%, min ${r.threshold}%)`)
    for (const s of r.survived) {
      console.log(`  SURVIVED ${s.file}:${s.line}:${s.column} [${s.operator}] ${s.original} -> ${s.mutated}`)
    }
  }
}

const runWithWorkDir = async (targets: ReadonlyArray<string>, gate: ReadonlyArray<string>, opts: CliOptions) => {
  const workDir = mkdtempSync(join(tmpdir(), 'mutate-'))
  try {
    const configPath = writeMutateConfig(workDir)
    const reports: Array<FileReport> = []
    for (const file of targets) {
      reports.push(await evaluateFile(file, gate, { concurrency: opts.concurrency, configPath, workDir }))
    }
    printReport(reports, opts.json)
    process.exitCode = reports.some((r) => r.score < r.threshold) ? 1 : 0
  } finally {
    rmSync(workDir, { force: true, recursive: true })
  }
}

const main = async (): Promise<void> => {
  const options = parseArgs(process.argv.slice(2))
  const gateFiles = parseCoverageGate(readFileSync('vitest.config.ts', 'utf8'))
  const changed =
    options.changed || options.since ? gitChangedFiles(options.since).filter((f) => gateFiles.includes(f)) : gateFiles
  const targets = options.files.length ? options.files : changed
  if (targets.length === 0) {
    console.log('mutate: no matching source files to test')
    return
  }
  await runWithWorkDir(targets, gateFiles, options)
}

if (import.meta.main) {
  await main()
}
