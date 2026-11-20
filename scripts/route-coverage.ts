import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

const ROUTES = 'src/routes'
const A11Y = 'tests/e2e/a11y.spec.ts'
const LANDMARKS = 'tests/e2e/landmarks.spec.ts'
const KEYBOARD = 'tests/e2e/keyboard.spec.ts'

export const pagePath = (file: string): string | undefined => {
  const segments = file.replace(/\.tsx?$/, '').split('/')
  if (segments[0] === 'api' || segments.some((segment) => segment.startsWith('-'))) {
    return undefined
  }
  const last = segments.at(-1) ?? ''
  if (last.startsWith('__') || (last.startsWith('_') && !last.includes('.'))) {
    return undefined
  }
  const path = segments
    .filter((segment) => segment !== 'index' && !segment.startsWith('_') && !/^\(.*\)$/.test(segment))
    .join('/')
  return `/${path}`
}

export const pageRoutes = (root = ROUTES): Array<string> =>
  readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.tsx?$/.test(entry.name))
    .map((entry) => pagePath(relative(root, join(entry.parentPath, entry.name)).split(sep).join('/')))
    .filter((path): path is string => path !== undefined)
    .toSorted()

const HELPERS: Array<[RegExp, string]> = [
  [/navigateWithApiResponse\(page, '\/api\/me[/']/, '/dashboard'],
  [/\bdashboardWithMyPost\(/, '/dashboard'],
  [/navigateWithApiResponse\(page, '\/api\/posts'/, '/'],
]
export const reachedPaths = (block: string): Set<string> => {
  const paths = new Set<string>()
  for (const [, path = ''] of block.matchAll(/\bvisit\(page, '([^'?#]*)/g)) {
    paths.add(path)
  }
  for (const [pattern, path] of HELPERS) {
    if (pattern.test(block)) {
      paths.add(path)
    }
  }
  return paths
}

const reaches = (reached: Set<string>, route: string) => {
  const pattern = new RegExp(
    `^${route.replaceAll(/[.*+?^{}()|[\]\\]/g, String.raw`\$&`).replaceAll(/\$[^/]*/g, '[^/]+')}$`,
  )
  return [...reached].some((path) => pattern.test(path))
}

type Spec = { file: string; text: string }

const readSpec = (file: string): Spec => ({ file, text: readFileSync(file, 'utf8') })

const between = (spec: Spec, start: string, end?: string) => {
  const from = spec.text.indexOf(start)
  const to = end === undefined ? spec.text.length : spec.text.indexOf(end, from + start.length)
  if (from === -1 || to === -1) {
    throw new Error(`${spec.file}: cannot find the block from "${start}" to "${end ?? 'the end of the file'}"`)
  }
  return spec.text.slice(from, to)
}

export const routeCoverageProblems = (): Array<string> => {
  const a11y = readSpec(A11Y)
  const landmarks = readSpec(LANDMARKS)
  const keyboard = readSpec(KEYBOARD)
  const suites: Array<[string, Set<string>]> = [
    [`an axe state in STATES (${A11Y})`, reachedPaths(between(a11y, 'const STATES', "test.describe('axe'"))],
    [`a landmark snapshot (${LANDMARKS})`, reachedPaths(between(landmarks, "test.describe('landmarks'"))],
    [`a tab-order row (${KEYBOARD})`, reachedPaths(between(keyboard, "test.describe('tab order'", "test.describe('"))],
  ]
  return pageRoutes().flatMap((path) => {
    const missing = suites.flatMap(([what, reached]) => (reaches(reached, path) ? [] : [what]))
    return missing.length ? [`${path} is missing ${missing.join(' and ')}`] : []
  })
}

export const routeCoverage = (): boolean => {
  const problems = routeCoverageProblems()
  for (const problem of problems) {
    console.error(problem)
  }
  return problems.length === 0
}

if (import.meta.main) {
  process.exitCode = routeCoverage() ? 0 : 1
}
