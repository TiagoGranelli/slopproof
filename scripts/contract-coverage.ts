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

const gapsOf = (op: Operation, statuses: Set<number>, allowlist: Allowlist): Array<Gap> => [
  ...missingFrom(op.declared, statuses).map((status) => ({
    excuses: allowlist.unobserved,
    operation: op.id,
    problem: `${op.id} declares ${status}, but no test saw it answered`,
    status,
  })),
  ...missingFrom(statuses, op.declared).map((status) => ({
    excuses: allowlist.undeclared,
    operation: op.id,
    problem: `${op.id} answered ${status}, which openapi.json does not declare`,
    status,
  })),
]

export const contractCoverageProblems = (
  ops: Array<Operation>,
  observed: Array<Observation>,
  allowlist: Allowlist,
): Array<string> => {
  const entries = [...allowlist.unobserved, ...allowlist.undeclared]
  const used = new Set<AllowEntry>()
  const gaps = [...observedStatuses(ops, observed)].flatMap(([op, statuses]) => gapsOf(op, statuses, allowlist))
  const unexcused = gaps.flatMap(({ excuses, operation, problem, status }) => {
    const entry = excuses.find((candidate) => matches(candidate, operation, status))
    if (entry) {
      used.add(entry)
    }
    return entry ? [] : [problem]
  })
  const stale = entries.flatMap((entry) =>
    used.has(entry) ? [] : [`${ALLOWLIST}: ${entry.operation} ${entry.status} matches no gap any more; remove it`],
  )
  return [...unexplained(entries), ...unexcused, ...stale]
}

if (import.meta.main) {
  const [observations, ...logs] = process.argv.slice(2)
  if (!observations) {
    console.error('usage: node scripts/contract-coverage.ts <observations directory> [log file ...]')
    process.exit(2)
  }
  const spec = JSON.parse(readFileSync('openapi.json', 'utf8')) as Parameters<typeof operations>[0]
  const fromApp = logs.flatMap((file) => logObservations(readFileSync(file, 'utf8')))
  const observed = [
    ...fromApp,
    ...(existsSync(observations) ? readdirSync(observations) : [])
      .filter((name) => name.endsWith('.jsonl'))
      .flatMap((name) =>
        readFileSync(join(observations, name), 'utf8')
          .split('\n')
          .filter(Boolean)
          .map((line) => JSON.parse(line) as Observation),
      ),
  ]
  const allowlist = JSON.parse(readFileSync(ALLOWLIST, 'utf8')) as Allowlist
  const ops = operations(spec)
  const problems = contractCoverageProblems(ops, observed, allowlist)
  for (const problem of problems) {
    console.error(problem)
  }
  const pairs = ops.reduce((sum, op) => sum + op.declared.size, 0)
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
  console.log(
    problems.length
      ? `contract coverage: ${problems.length} problem(s)`
      : `contract coverage: all ${pairs} declared operation × status pairs observed (${observed.length} responses)`,
  )
  process.exitCode = problems.length ? 1 : 0
}
