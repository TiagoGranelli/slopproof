import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { Client } from 'pg'
import { x } from 'tinyexec'
import { dropTestDatabase, resetTestDatabase, testDatabaseUrl } from './test-db.ts'

if (existsSync('.env')) {
  process.loadEnvFile('.env')
}

const SCHEMA = './src/server/db/schema/index.ts'
const MIGRATIONS = 'drizzle'

const pnpm = async (args: Array<string>) => {
  const outcome = await x('pnpm', args, { nodeOptions: { stdio: ['ignore', 'pipe', 'pipe'] }, timeout: 120_000 })
  const output = `${outcome.stdout}${outcome.stderr}`
  if (outcome.exitCode !== 0) {
    throw new Error(`pnpm ${args.join(' ')} failed (exit ${outcome.exitCode ?? 'unknown'}, expected 0)\n${output}`)
  }
  return output
}

const git = (args: Array<string>) => spawnSync('git', args, { encoding: 'utf8' })

const checks = {
  async auth() {
    const authCheck = await x('pnpm', ['exec', 'auth', 'check', 'schema', '--config', 'src/server/auth.ts'], {
      nodeOptions: {
        env: {
          APP_URL: process.env.APP_URL || 'http://localhost:3000',
          BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET || 'check-drift-placeholder-secret-0123456789',
          DATABASE_URL: process.env.DATABASE_URL || 'postgres://unused@127.0.0.1:1/unused',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
      timeout: 120_000,
    })
    if (authCheck.exitCode === 0) {
      return []
    }
    const report = `${authCheck.stdout}${authCheck.stderr}`.trim()
    return [`src/server/db/schema/auth.ts does not hold what src/server/auth.ts writes:\n${report}`]
  },

  async contract() {
    const before = git(['stash', 'create']).stdout.trim() || 'HEAD'
    await pnpm(['codegen'])
    const diff = git(['diff', '--exit-code', '--stat', before, '--', 'openapi.json', 'src/sdk'])
    if (diff.status === 0) {
      return []
    }
    return [`\`pnpm codegen\` changed these files; review and commit them:\n${diff.stdout.trimEnd()}${diff.stderr}`]
  },

  async database() {
    const url = testDatabaseUrl('drift', process.env.DRIFT_DATABASE_URL)
    await resetTestDatabase(url)
    try {
      const before = await fingerprint(url)
      const push = ['exec', 'drizzle-kit', 'push', '--dialect=postgresql', `--schema=${SCHEMA}`]
      const output = await pnpm([...push, `--url=${url}`, '--force'])
      if (before === (await fingerprint(url))) {
        return []
      }
      return [
        `migrations in ${MIGRATIONS}/ do not produce the Drizzle schema; drizzle-kit push had to change:\n${output.trim()}`,
      ]
    } finally {
      if (!process.env.DRIFT_DATABASE_URL) {
        await dropTestDatabase(url)
      }
    }
  },

  async migrations() {
    const dir = join(mkdtempSync(join(tmpdir(), 'check-drift-')), 'drizzle')
    try {
      cpSync(MIGRATIONS, dir, { recursive: true })
      const out = relative(process.cwd(), dir)
      await pnpm(['exec', 'drizzle-kit', 'generate', '--dialect=postgresql', `--schema=${SCHEMA}`, `--out=${out}`])
      await pnpm(['exec', 'drizzle-kit', 'check', '--dialect=postgresql', `--out=${MIGRATIONS}`])
      const added = readdirSync(dir).filter((file) => !existsSync(join(MIGRATIONS, file)))
      return added.map((file) => `the schema needs ${file}: run \`pnpm db:generate --name <slug>\``)
    } finally {
      rmSync(join(dir, '..'), { force: true, recursive: true })
    }
  },
}

const FINGERPRINT_QUERIES = [
  `select table_name, column_name, data_type, udt_name, is_nullable, column_default, character_maximum_length
     from information_schema.columns where table_schema = 'public' order by 1, 2`,
  `select conrelid::regclass::text, conname, pg_get_constraintdef(oid) from pg_constraint
     where connamespace = 'public'::regnamespace order by 1, 2`,
  `select tablename, indexname, indexdef from pg_indexes where schemaname = 'public' order by 1, 2`,
  `select t.typname, e.enumlabel from pg_enum e join pg_type t on t.oid = e.enumtypid order by 1, e.enumsortorder`,
  `select relname, relpersistence from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r'
     order by 1`,
]

const fingerprint = async (url: string) => {
  const client = new Client({ connectionString: url })
  await client.connect()
  try {
    const rowsPerQuery = []
    for (const query of FINGERPRINT_QUERIES) {
      rowsPerQuery.push((await client.query({ rowMode: 'array', text: query })).rows)
    }
    return JSON.stringify(rowsPerQuery)
  } finally {
    await client.end()
  }
}

type CheckName = keyof typeof checks
const requested = process.argv.slice(2) as Array<CheckName>
const unknown = requested.filter((name) => !(name in checks))
if (unknown.length) {
  throw new Error(`unknown check(s): ${unknown.join(', ')}; expected any of ${Object.keys(checks).join(', ')}`)
}

type CheckOutcome = { lines: Array<string>; ok: boolean }

const runCheck = async (name: CheckName): Promise<CheckOutcome> => {
  try {
    const problems = await checks[name]()
    if (problems.length === 0) {
      return { lines: [`ok    ${name}`], ok: true }
    }
    return { lines: [`DRIFT ${name}\n${problems.map((p) => `  - ${p}`).join('\n')}`], ok: false }
  } catch (error) {
    return { lines: [`ERROR ${name}: ${error instanceof Error ? error.message : String(error)}`], ok: false }
  }
}

const printOutcome = ({ lines, ok }: CheckOutcome) => {
  for (const line of lines) {
    ;(ok ? console.log : console.error)(line)
  }
}

const selected = requested.length ? requested : (Object.keys(checks) as Array<CheckName>)
const outcomes = await Promise.all(selected.map((name) => runCheck(name)))
for (const outcome of outcomes) {
  printOutcome(outcome)
}
process.exitCode = outcomes.every(({ ok }) => ok) ? 0 : 1
