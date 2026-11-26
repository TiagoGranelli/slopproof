import { spawnSync } from 'node:child_process'
import { closeSync, existsSync, openSync, readdirSync, readFileSync, readSync, statSync } from 'node:fs'
import { join, sep } from 'node:path'
import { describe, expect, it } from 'vitest'
import { APP_NAME } from '#/config/app.ts'

const read = (file: string) => readFileSync(file, 'utf8')
const git = (...args: Array<string>) => spawnSync('git', args, { encoding: 'utf8' })

const GENERATED = [join('src', 'sdk', ''), join('src', 'routeTree.gen.ts')]
const codeFiles = () =>
  [
    ...['src', 'tests', 'scripts'].flatMap((dir) =>
      readdirSync(dir, { encoding: 'utf8', recursive: true }).map((path) => join(dir, path)),
    ),
    ...readdirSync('.').filter((file) => file.endsWith('.config.ts')),
  ]
    .filter((file) => /\.(?:ts|tsx|mts)$/.test(file) && !GENERATED.some((prefix) => file.startsWith(prefix)))
    .toSorted()

const DIRECTIVE = /^\s*(?:\/\/|\/\*)\s*(?:oxlint|eslint)-disable|\/\/\s*(?:oxlint|eslint)-disable-line/
const COMMENT = /^\s*(?:\/\/|\/\*|\*)/

it('every lint suppression has its reason on the comment line above it', () => {
  const bare = codeFiles().flatMap((file) => {
    const lines = read(file).split('\n')
    return lines.flatMap((line, index) => {
      const above = lines[index - 1] ?? ''
      return DIRECTIVE.test(line) && !(COMMENT.test(above) && !DIRECTIVE.test(above))
        ? [`${file}:${index + 1}: fix the finding, or say why the rule is wrong here in a comment line above`]
        : []
    })
  })
  expect(bare).toEqual([])
})

it('every squawk waiver has its reason on the comment line above it', () => {
  const bare = readdirSync('drizzle')
    .filter((name) => name.endsWith('.sql'))
    .flatMap((name) => {
      const lines = read(join('drizzle', name)).split('\n')
      return lines.flatMap((line, index) => {
        const above = lines[index - 1] ?? ''
        return /^\s*--\s*squawk-ignore/.test(line) && (!/^\s*--\s*\S/.test(above) || above.includes('squawk-ignore'))
          ? [`drizzle/${name}:${index + 1}: say why in a comment line above (docs/operations.md, "Migration safety")`]
          : []
      })
    })
  expect(bare).toEqual([])
})

it('pins every dependency to one exact version', () => {
  const EXACT = /^\d+\.\d+\.\d+(?:-[\w.-]+)?(?:\+[\w.-]+)?$/
  const pkg = JSON.parse(read('package.json')) as Partial<Record<string, Record<string, string>>>
  const ranges = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'].flatMap((section) =>
    Object.entries(pkg[section] ?? {})
      .filter(([, version]) => !EXACT.test(version))
      .map(([name, version]) => `${section}.${name} is "${version}": \`pnpm add --save-exact ${name}@<version>\``),
  )
  expect(ranges).toEqual([])
  expect(read('pnpm-workspace.yaml')).toMatch(/^savePrefix: ''$/m)
})

describe('applied migrations', () => {
  const base = process.env.CHECK_BASE_REF ?? 'HEAD'
  const JOURNAL = 'drizzle/meta/_journal.json'
  const restore = `restore them (\`git checkout ${base} -- drizzle\`), then change the schema and run \`pnpm db:generate --name <slug>\``
  const hasBase = git('rev-parse', '--verify', '--quiet', `${base}^{commit}`).status === 0

  it('has the base commit to compare with', () => {
    expect(
      hasBase || process.env.CHECK_BASE_REF === undefined,
      `git ref ${base} is missing: fetch the parent commit (actions/checkout fetch-depth: 2)`,
    ).toBe(true)
  })

  it.runIf(hasBase)('are never edited or deleted', () => {
    const changed = git('diff', '--diff-filter=MD', '--name-only', base, '--', 'drizzle/*.sql').stdout
    expect(
      changed
        .split('\n')
        .filter(Boolean)
        .map((file) => `${file}: ${restore}`),
    ).toEqual([])
  })

  it.runIf(hasBase)('keep their journal entries', () => {
    type Journal = { entries: Array<unknown> }
    const before = git('show', `${base}:${JOURNAL}`)
    const applied = before.status === 0 ? (JSON.parse(before.stdout) as Journal).entries : []
    const current = (JSON.parse(read(JOURNAL)) as Journal).entries
    expect(current.slice(0, applied.length), `${JOURNAL}: ${restore}`).toEqual(applied)
  })
})

const BINARY_SAMPLE_BYTES = 8192

const readTextFile = (file: string) => {
  const fd = openSync(file, 'r')
  try {
    const sample = Buffer.alloc(BINARY_SAMPLE_BYTES)
    const readBytes = readSync(fd, sample, 0, BINARY_SAMPLE_BYTES, 0)
    if (sample.subarray(0, readBytes).includes(0)) {
      return undefined
    }
    return readBytes < BINARY_SAMPLE_BYTES ? sample.toString('utf8', 0, readBytes) : read(file)
  } finally {
    closeSync(fd)
  }
}

const NAME_ALLOWED = [/^package\.json$/, /^src\/config\/app\.ts$/, /^openapi\.json$/, /^LICENSE$/, /\.md$/]

it('names the app only in package.json, src/config/app.ts and docs', () => {
  const slug = (JSON.parse(read('package.json')) as { name: string }).name
  const name = new RegExp(`${slug}|${APP_NAME.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`)}`, 'i')
  const offenders = git('ls-files', '-z', '--cached', '--others', '--exclude-standard')
    .stdout.split('\0')
    .filter((file) => file !== '' && !NAME_ALLOWED.some((pattern) => pattern.test(file)))
    .filter((file) => {
      if (!existsSync(file) || !statSync(file).isFile()) {
        return false
      }
      const content = readTextFile(file)
      return content !== undefined && name.test(content)
    })
    .map((file) => `${file}: import APP_NAME or pageTitle from #/config/app.ts, or use a neutral name (app_, CHECK_…)`)
  expect(offenders).toEqual([])
})

it('keeps Tailwind from scanning the build output', () => {
  expect(read('src/styles/app.css'), 'src/styles/app.css: keep `@import "tailwindcss" source("../")`').toMatch(
    /@import\s+['"]tailwindcss['"]\s+source\(\s*['"]\.\.\/['"]\s*\)/,
  )
})

it('names every folder under src/ in kebab-case', () => {
  const FOLDER = /^(?:[_$-]?[a-z0-9]+(?:-[a-z0-9]+)*|\([a-z0-9]+(?:-[a-z0-9]+)*\))$/
  const bad = readdirSync('src', { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !FOLDER.test(entry.name))
    .map((entry) => join(entry.parentPath, entry.name))
    .filter((folder) => !folder.startsWith(join('src', 'sdk')))
    .map((folder) => `${folder}/: rename it in kebab-case with \`git mv\``)
  expect(bad).toEqual([])
})

const chainBytes = (file: string) =>
  file
    .split(sep)
    .map((_, index, parts) => join(...parts.slice(0, index), 'AGENTS.md'))
    .filter((path) => existsSync(path))
    .reduce((total, path) => total + statSync(path).size, 0)

it('keeps the AGENTS.md files within their size budget', () => {
  const nested = ['src', 'tests', 'scripts', 'docs'].flatMap((dir) =>
    readdirSync(dir, { encoding: 'utf8', recursive: true }).flatMap((path) =>
      path.split(sep).at(-1) === 'AGENTS.md' ? [join(dir, path)] : [],
    ),
  )
  const over = [['AGENTS.md', 14 * 1024] as const, ...nested.map((file) => [file, 28 * 1024] as const)].flatMap(
    ([file, budget]) =>
      chainBytes(file) > budget
        ? [
            `${file}: ${chainBytes(file)} bytes with the AGENTS.md files above it, over ${budget}. Move reference ` +
              'material behind a pointer (a nested AGENTS.md, a skill or a doc)',
          ]
        : [],
  )
  expect(over).toEqual([])
})
