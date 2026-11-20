import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, sep } from 'node:path'
import { xSync } from 'tinyexec'

export type Feature = {
  apiOperations: Array<string>
  id: string
  paths: Array<string>
  purpose: string
  routes: Array<string>
  tests: Array<string>
  verify: string
}

export type CheckOptions = {
  features?: ReadonlyArray<Feature>
  openapiOperations?: ReadonlyArray<string>
  roots?: ReadonlyArray<string>
}

type OpenApiDoc = { paths?: Record<string, Record<string, { operationId?: string }>> }

const FEATURES_FILE = 'docs/agents/features.json'
const OPENAPI_FILE = 'openapi.json'
const OWNED_ROOTS = ['src/features', 'src/routes', 'src/server/api', 'src/contract']

const normalizePath = (raw: string): string => raw.replaceAll('\\', '/').replace(/^\.\//, '').replace(/\/+$/, '')

const ownsFile = (feature: Feature, target: string): boolean =>
  feature.paths.some((owned) => {
    const clean = normalizePath(owned)
    return target === clean || target.startsWith(`${clean}/`)
  })

const matchesQuery = (owned: string, target: string): boolean => {
  const clean = normalizePath(owned)
  return target === clean || target.startsWith(`${clean}/`) || clean.startsWith(`${target}/`)
}

export const loadFeatures = (file = FEATURES_FILE): Array<Feature> =>
  JSON.parse(readFileSync(file, 'utf8')) as Array<Feature>

export const featuresForPath = (rawPath: string, features: ReadonlyArray<Feature> = loadFeatures()): Array<Feature> => {
  const target = normalizePath(rawPath)
  return features.filter((feature) => feature.paths.some((owned) => matchesQuery(owned, target)))
}

const listCodeFiles = (roots: ReadonlyArray<string>): Array<string> =>
  roots
    .flatMap((root) =>
      readdirSync(root, { recursive: true, withFileTypes: true })
        .filter((entry) => entry.isFile() && /\.tsx?$/.test(entry.name))
        .map((entry) => join(entry.parentPath, entry.name).split(sep).join('/')),
    )
    .toSorted()

const readOpenApiOperations = (file = OPENAPI_FILE): Array<string> => {
  const doc = JSON.parse(readFileSync(file, 'utf8')) as OpenApiDoc
  return Object.values(doc.paths ?? {})
    .flatMap((methods) => Object.values(methods))
    .map((spec) => spec.operationId)
    .filter((operationId): operationId is string => typeof operationId === 'string')
    .toSorted()
}

const duplicateIdProblems = (features: ReadonlyArray<Feature>): Array<string> => {
  const seen = new Set<string>()
  const problems: Array<string> = []
  for (const feature of features) {
    if (seen.has(feature.id)) {
      problems.push(`duplicate feature id "${feature.id}"`)
    }
    seen.add(feature.id)
  }
  return problems
}

const missingEntryProblems = (features: ReadonlyArray<Feature>): Array<string> =>
  features.flatMap((feature) => [
    ...feature.paths.filter((path) => !existsSync(path)).map((path) => `${feature.id}: path does not exist: ${path}`),
    ...feature.tests
      .filter((testPath) => !existsSync(testPath))
      .map((testPath) => `${feature.id}: test does not exist: ${testPath}`),
  ])

const unownedFileProblems = (features: ReadonlyArray<Feature>, roots: ReadonlyArray<string>): Array<string> =>
  listCodeFiles(roots)
    .filter((file) => !features.some((feature) => ownsFile(feature, file)))
    .map((file) => `unowned source file: ${file} (add it to docs/agents/features.json)`)

const operationProblems = (
  features: ReadonlyArray<Feature>,
  openapiOperations: ReadonlyArray<string>,
): Array<string> => {
  const known = new Set(openapiOperations)
  const mapped = new Set(features.flatMap((feature) => feature.apiOperations))
  const unmapped = openapiOperations.flatMap((operationId) =>
    mapped.has(operationId) ? [] : [`unmapped OpenAPI operation: ${operationId} (add it to docs/agents/features.json)`],
  )
  const unknown = features.flatMap((feature) =>
    feature.apiOperations.flatMap((operationId) =>
      known.has(operationId) ? [] : [`${feature.id}: unknown OpenAPI operation "${operationId}"`],
    ),
  )
  return [...unmapped, ...unknown]
}

export const checkFeatures = (options: CheckOptions = {}): Array<string> => {
  const features = options.features ?? loadFeatures()
  const roots = options.roots ?? OWNED_ROOTS
  const openapiOperations = options.openapiOperations ?? readOpenApiOperations()
  return [
    ...duplicateIdProblems(features),
    ...missingEntryProblems(features),
    ...unownedFileProblems(features, roots),
    ...operationProblems(features, openapiOperations),
  ]
}

const findFeature = (features: ReadonlyArray<Feature>, id: string | undefined): Feature | undefined => {
  const matched = id ? features.find((feature) => feature.id === id) : undefined
  if (!matched) {
    const ids = features.map((feature) => feature.id).join(', ')
    console.error(`unknown feature "${id ?? ''}". Available: ${ids}`)
  }
  return matched
}

const formatSection = (label: string, values: ReadonlyArray<string>): string =>
  values.length > 0 ? `${label}:\n${values.map((entry) => `  - ${entry}`).join('\n')}` : `${label}: (none)`

const runList = (features: ReadonlyArray<Feature>): number => {
  const width = Math.max(...features.map((feature) => feature.id.length), 0)
  for (const feature of features) {
    console.log(`${feature.id.padEnd(width)}  ${feature.purpose}`)
  }
  return 0
}

const runShow = (features: ReadonlyArray<Feature>, id: string | undefined): number => {
  const feature = findFeature(features, id)
  if (!feature) {
    return 1
  }
  console.log(`${feature.id} — ${feature.purpose}`)
  console.log(formatSection('routes', feature.routes))
  console.log(formatSection('apiOperations', feature.apiOperations))
  console.log(formatSection('paths', feature.paths))
  console.log(formatSection('tests', feature.tests))
  console.log(`verify: ${feature.verify}`)
  return 0
}

const runWhere = (features: ReadonlyArray<Feature>, rawPath: string | undefined): number => {
  if (!rawPath) {
    console.error('usage: node scripts/features.ts where <path>')
    return 2
  }
  const matches = featuresForPath(rawPath, features)
  if (matches.length === 0) {
    console.error(`no feature owns "${rawPath}"`)
    return 1
  }
  return runList(matches)
}

const runVerify = (features: ReadonlyArray<Feature>, id: string | undefined): number => {
  const feature = findFeature(features, id)
  if (!feature) {
    return 1
  }
  const [tool = '', ...args] = feature.verify.trim().split(/\s+/)
  console.log(`$ ${feature.verify}`)
  const { exitCode } = xSync(tool, args, { nodeOptions: { stdio: 'inherit' } })
  return exitCode ?? 1
}

const runCheck = (features: ReadonlyArray<Feature>): number => {
  const problems = checkFeatures({ features })
  for (const problem of problems) {
    console.error(problem)
  }
  if (problems.length === 0) {
    console.log(`ok (${features.length} features)`)
  }
  return problems.length === 0 ? 0 : 1
}

type CommandRunner = (features: ReadonlyArray<Feature>, arg: string | undefined) => number

const COMMANDS = new Map<string, CommandRunner>([
  ['check', (features) => runCheck(features)],
  ['list', (features) => runList(features)],
  ['show', (features, arg) => runShow(features, arg)],
  ['verify', (features, arg) => runVerify(features, arg)],
  ['where', (features, arg) => runWhere(features, arg)],
])

const main = (argv: ReadonlyArray<string>): number => {
  const [command, arg] = argv
  const runner = command ? COMMANDS.get(command) : undefined
  if (!runner) {
    console.error('usage: node scripts/features.ts <list|show <id>|where <path>|verify <id>|check>')
    return 2
  }
  return runner(loadFeatures(), arg)
}

if (import.meta.main) {
  process.exitCode = main(process.argv.slice(2))
}
