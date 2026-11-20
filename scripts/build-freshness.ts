import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

const BUILD_INPUTS = ['src', 'public', 'vite.config.ts', 'package.json', 'pnpm-lock.yaml', 'tsconfig.json']
const STAMP = '.output/build-inputs.json'

type InputHashes = Record<string, string>

const filesOf = (root: string, input: string): Array<string> => {
  const path = join(root, input)
  if (!existsSync(path)) {
    return []
  }
  if (!statSync(path).isDirectory()) {
    return [path]
  }
  return readdirSync(path, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name))
}

const sha256 = (file: string): string => createHash('sha256').update(readFileSync(file)).digest('hex')

export const hashBuildInputs = (root = '.'): InputHashes => {
  const files = BUILD_INPUTS.flatMap((input) => filesOf(root, input))
  const hashes = files.map((file) => [relative(root, file).split(sep).join('/'), sha256(file)] as const)
  return Object.fromEntries(hashes.toSorted(([a], [b]) => a.localeCompare(b)))
}

export const writeBuildStamp = (root = '.'): void => {
  writeFileSync(join(root, STAMP), `${JSON.stringify(hashBuildInputs(root), null, 2)}\n`)
}

const changedInputs = (built: InputHashes, now: InputHashes): Array<string> => {
  const paths = new Set([...Object.keys(built), ...Object.keys(now)])
  return [...paths].filter((path) => built[path] !== now[path]).toSorted()
}

const listSome = (paths: Array<string>): string =>
  paths.slice(0, 10).join(', ') + (paths.length > 10 ? ` and ${paths.length - 10} more` : '')

const assertBuildExists = (root: string): void => {
  const output = join(root, '.output')
  if (!existsSync(join(output, 'server/index.mjs')) || !existsSync(join(output, 'nitro.json'))) {
    throw new Error(`No build in ${output} (expected server/index.mjs and nitro.json). Run \`pnpm build\` first.`)
  }
}

export const assertFreshBuild = (root = '.'): void => {
  assertBuildExists(root)
  if (process.env.ALLOW_STALE_BUILD === '1') {
    return
  }
  if (!existsSync(join(root, STAMP))) {
    throw new Error(`${STAMP} is missing, so .output was not built by \`pnpm build\`. Run \`pnpm build\` first.`)
  }
  const built = JSON.parse(readFileSync(join(root, STAMP), 'utf8')) as InputHashes
  const changed = changedInputs(built, hashBuildInputs(root))
  if (changed.length === 0) {
    return
  }
  throw new Error(
    `.output is older than its sources: ${listSome(changed)} changed since \`pnpm build\`. Run \`pnpm build\` ` +
      'first (or set ALLOW_STALE_BUILD=1 to test the old build anyway).',
  )
}
