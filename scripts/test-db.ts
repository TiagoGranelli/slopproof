import { existsSync } from 'node:fs'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { Client, Pool } from 'pg'

const assertTestName = (name: string) => {
  if (!/^[a-z0-9_]+_test$/.test(name)) {
    throw new Error(`refusing to use database "${name}": test database names must match [a-z0-9_]+_test`)
  }
  return name
}

const adminUrl = (url: string) => Object.assign(new URL(url), { pathname: '/postgres' }).toString()

export const baseDatabaseUrl = (): string => {
  if (!process.env.DATABASE_URL && existsSync('.env')) {
    process.loadEnvFile('.env')
  }
  const url = process.env.DATABASE_URL?.trim()
  if (!url) {
    throw new Error(
      existsSync('.env')
        ? 'DATABASE_URL is not set in .env. Copy it from .env.example, or run `pnpm bootstrap`.'
        : 'No .env file and no DATABASE_URL. Run `pnpm bootstrap` (creates .env and starts Postgres).',
    )
  }
  return url
}

export const testDatabaseUrl = (purpose: string, override?: string): string => {
  const url = override?.trim()
    ? new URL(override.trim())
    : Object.assign(new URL(baseDatabaseUrl()), { pathname: `/app_${purpose}_${process.pid}_test` })
  assertTestName(url.pathname.slice(1))
  return url.toString()
}

const connectAdmin = async (url: string) => {
  const admin = new Client({ connectionString: adminUrl(url), connectionTimeoutMillis: 5000 })
  try {
    await admin.connect()
  } catch (error) {
    const { host } = new URL(url)
    const reason = error instanceof Error ? error.message : String(error)
    throw new Error(
      `cannot reach Postgres at ${host} (${reason}). Start it with \`pnpm db:up\` (first time: \`pnpm bootstrap\`).`,
      { cause: error },
    )
  }
  return admin
}

const administer = async (testUrl: string, statements: (name: string) => Array<string>) => {
  const name = assertTestName(new URL(testUrl).pathname.slice(1))
  const admin = await connectAdmin(testUrl)
  try {
    for (const statement of statements(name)) {
      await admin.query(statement)
    }
  } finally {
    await admin.end()
  }
}

export const dropTestDatabase = (testUrl: string): Promise<void> =>
  administer(testUrl, (name) => [`drop database if exists "${name}" with (force)`])

const RUN_DATABASE = /^app_[a-z0-9]+_(\d+)_test$/

const isRunning = (pid: number) => {
  try {
    return process.kill(pid, 0)
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

const isAbandoned = (name: string) => {
  const pid = Number(RUN_DATABASE.exec(name)?.[1])
  return Boolean(pid) && pid !== process.pid && !isRunning(pid)
}

const dropAbandoned = async (testUrl: string) => {
  const admin = await connectAdmin(testUrl)
  try {
    const { rows } = await admin.query<{ datname: string }>('select datname from pg_database')
    for (const name of rows.map(({ datname }) => datname).filter((datname) => isAbandoned(datname))) {
      await admin.query(`drop database if exists "${name}" with (force)`)
    }
  } finally {
    await admin.end()
  }
}

export const emptyTestDatabase = async (testUrl: string): Promise<void> => {
  await dropAbandoned(testUrl)
  await administer(testUrl, (name) => [`drop database if exists "${name}" with (force)`, `create database "${name}"`])
}

export const resetTestDatabase = async (testUrl: string): Promise<void> => {
  await emptyTestDatabase(testUrl)
  const pool = new Pool({ connectionString: testUrl })
  pool.on('connect', (client) => client.on('notice', () => {}))
  try {
    await migrate(drizzle({ client: pool }), { migrationsFolder: 'drizzle' })
  } finally {
    await pool.end()
  }
}

export const openConnections = async (testUrl: string): Promise<Array<{ application_name: string; n: number }>> => {
  const name = assertTestName(new URL(testUrl).pathname.slice(1))
  const admin = await connectAdmin(testUrl)
  try {
    const { rows } = await admin.query<{ application_name: string; n: number }>(
      `select application_name, count(*)::int as n from pg_stat_activity
        where datname = $1 and pid <> pg_backend_pid() group by 1 order by 1`,
      [name],
    )
    return rows
  } finally {
    await admin.end()
  }
}

if (import.meta.main) {
  const url = process.env.TEST_DATABASE_URL
  if (!url) {
    throw new Error('TEST_DATABASE_URL is not set; expected a postgres:// URL whose database name ends in _test')
  }
  await resetTestDatabase(url)
  console.log(`reset ${new URL(url).pathname.slice(1)} and applied migrations`)
}
