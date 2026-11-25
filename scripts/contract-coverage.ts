import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Json } from '#/contract/json.ts'

type Operation = { declared: Set<number>; id: string; method: string; pattern: RegExp }
type Observation = { method: string; path: string; status: number }
type AllowEntry = { operation: string; reason?: string; status: number }
type Allowlist = { undeclared: Array<AllowEntry>; unobserved: Array<AllowEntry> }

export const ALLOWLIST = 'tests/contract-coverage-allowlist.json'

export const operations = (spec: {
  paths: Record<string, Record<string, { responses: Record<string, Json> }>>
}): Array<Operation> =>
  Object.entries(spec.paths).flatMap(([path, methods]) =>
    Object.entries(methods).map(([method, operation]) => ({
      declared: new Set(Object.keys(operation.responses).map(Number)),
      id: `${method.toUpperCase()} ${path}`,
      method: method.toUpperCase(),
      pattern: new RegExp(`^${path.replaceAll(/\{[^}]+\}/g, '[^/]+')}$`),
    })),
  )

type LogEntry = { aborted?: unknown; method?: unknown; msg?: unknown; path?: unknown; status?: unknown }

const parseLogLine = (line: string): LogEntry | undefined => {
  if (!line.startsWith('{')) {
    return undefined
  }
  try {
    return JSON.parse(line) as LogEntry
  } catch {
    return undefined
  }
}

const answeredRequest = (entry: LogEntry | undefined): Observation | undefined => {
  if (entry?.msg !== 'request' || entry.aborted === true) {
    return undefined
  }
  const { method, path, status } = entry
  if (typeof method !== 'string' || typeof path !== 'string' || typeof status !== 'number') {
    return undefined
  }
  return { method, path, status }
}

export const logObservations = (text: string): Array<Observation> =>
  text.split('\n').flatMap((line) => answeredRequest(parseLogLine(line)) ?? [])

const matches = (entry: AllowEntry, operation: string, status: number) =>
  (entry.operation === '*' || entry.operation === operation) && entry.status === status

const unexplained = (entries: Array<AllowEntry>) =>
  entries.flatMap((entry) =>
    entry.reason?.trim() ? [] : [`${ALLOWLIST}: ${entry.operation} ${entry.status} needs a reason`],
  )

const observedStatuses = (ops: Array<Operation>, observed: Array<Observation>) => {
  const seen = new Map(ops.map((op) => [op, new Set<number>()]))
  for (const { method, path, status } of observed) {
    const op = ops.find((candidate) => candidate.method === method && candidate.pattern.test(path))
    if (op) {
      seen.get(op)?.add(status)
    }
  }
  return seen
}

type Gap = { excuses: Array<AllowEntry>; operation: string; problem: string; status: number }

const missingFrom = (statuses: Set<number>, other: Set<number>) => [...statuses].filter((status) => !other.has(status))

const undeclaredGapsOf = (op: Operation, statuses: Set<number>, allowlist: Allowlist): Array<Gap> =>
  missingFrom(statuses, op.declared).map((status) => ({
    excuses: allowlist.undeclared,
    operation: op.id,
    problem: `${op.id} answered ${status}, which openapi.json does not declare`,
    status,
  }))

const gapsOf = (op: Operation, statuses: Set<number>, allowlist: Allowlist): Array<Gap> => [
  ...missingFrom(op.declared, statuses).map((status) => ({
    excuses: allowlist.unobserved,
    operation: op.id,
    problem: `${op.id} declares ${status}, but no test saw it answered`,
    status,
  })),
  ...undeclaredGapsOf(op, statuses, allowlist),
]

const partitionGaps = (gaps: Array<Gap>) => {
  const used = new Set<AllowEntry>()
  const unexcused = gaps.flatMap(({ excuses, operation, problem, status }) => {
    const entry = excuses.find((candidate) => matches(candidate, operation, status))
    if (entry) {
      used.add(entry)
    }
    return entry ? [] : [problem]
  })
  return { unexcused, used }
}

export const contractCoverageProblems = (
  ops: Array<Operation>,
  observed: Array<Observation>,
  allowlist: Allowlist,
): Array<string> => {
  const entries = [...allowlist.unobserved, ...allowlist.undeclared]
  const gaps = [...observedStatuses(ops, observed)].flatMap(([op, statuses]) => gapsOf(op, statuses, allowlist))
  const { unexcused, used } = partitionGaps(gaps)
  const stale = entries.flatMap((entry) =>
    used.has(entry) ? [] : [`${ALLOWLIST}: ${entry.operation} ${entry.status} matches no gap any more; remove it`],
  )
  return [...unexplained(entries), ...unexcused, ...stale]
}

export const undeclaredStatusProblems = (
  ops: Array<Operation>,
  observed: Array<Observation>,
  allowlist: Allowlist,
): Array<string> => {
  const gaps = [...observedStatuses(ops, observed)].flatMap(([op, statuses]) =>
    undeclaredGapsOf(op, statuses, allowlist),
  )
  const { unexcused } = partitionGaps(gaps)
  return [...unexplained(allowlist.undeclared), ...unexcused]
}

const dirObservations = (dir: string) =>
  existsSync(dir)
    ? readdirSync(dir)
        .filter((name) => name.endsWith('.jsonl'))
        .flatMap((name) =>
          readFileSync(join(dir, name), 'utf8')
            .split('\n')
            .filter(Boolean)
            .map((line) => JSON.parse(line) as Observation),
        )
    : []

const printInMemoryOnly = (ops: Array<Operation>, fromApp: Array<Observation>, observed: Array<Observation>) => {
  const seenIn = (list: Array<Observation>, op: Operation, status: number) =>
    list.some((o) => o.method === op.method && op.pattern.test(o.path) && o.status === status)
  const inMemoryOnly = ops.flatMap((op) =>
    [...op.declared].flatMap((status) =>
      !seenIn(fromApp, op, status) && seenIn(observed, op, status) ? [`${op.id} ${status}`] : [],
    ),
  )
  if (inMemoryOnly.length) {
    console.log(`seen only in the api layer, not from the built app: ${inMemoryOnly.join(', ')}`)
  }
}

const parseCliArgs = (argv: Array<string>) => {
  const undeclaredOnly = argv[0] === '--undeclared-only'
  const rest = undeclaredOnly ? argv.slice(1) : argv
  const observations = undeclaredOnly ? undefined : rest[0]
  const logs = undeclaredOnly ? rest : rest.slice(1)
  if ((!undeclaredOnly && !observations) || (undeclaredOnly && !logs.length)) {
    console.error('usage: node scripts/contract-coverage.ts [--undeclared-only] <observations dir | log file ...>')
    process.exit(2)
  }
  return { logs, observations, undeclaredOnly }
}

const printProblems = (problems: Array<string>, summary: string) => {
  for (const problem of problems) {
    console.error(problem)
  }
  console.log(problems.length ? `contract coverage: ${problems.length} problem(s)` : summary)
  return problems.length ? 1 : 0
}

const runCli = () => {
  const { logs, observations, undeclaredOnly } = parseCliArgs(process.argv.slice(2))
  const spec = JSON.parse(readFileSync('openapi.json', 'utf8')) as Parameters<typeof operations>[0]
  const fromApp = logs.flatMap((file) => logObservations(readFileSync(file, 'utf8')))
  const observed = observations ? [...fromApp, ...dirObservations(observations)] : fromApp
  const allowlist = JSON.parse(readFileSync(ALLOWLIST, 'utf8')) as Allowlist
  const ops = operations(spec)
  const problems = (undeclaredOnly ? undeclaredStatusProblems : contractCoverageProblems)(ops, observed, allowlist)
  const pairs = ops.reduce((sum, op) => sum + op.declared.size, 0)
  if (!undeclaredOnly) {
    printInMemoryOnly(ops, fromApp, observed)
  }
  const summary = undeclaredOnly
    ? `contract coverage (undeclared): clean across ${observed.length} responses`
    : `contract coverage: all ${pairs} declared operation × status pairs observed (${observed.length} responses)`
  return printProblems(problems, summary)
}

if (import.meta.main) {
  process.exitCode = runCli()
}
