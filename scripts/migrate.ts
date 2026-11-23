import { existsSync } from 'node:fs'
import { setTimeout as delay } from 'node:timers/promises'
import { readMigrationFiles } from 'drizzle-orm/migrator'
import { Client } from 'pg'

const LOCK_KEY = '8098991147069224299'
const LOCK_WAIT = process.env.MIGRATE_LOCK_TIMEOUT ?? '5min'
const DDL_LOCK_WAIT = process.env.MIGRATE_DDL_LOCK_TIMEOUT ?? '5s'
const DDL_ATTEMPTS = 5
const LOCK_NOT_AVAILABLE = '55P03'
const TABLE = 'drizzle.__drizzle_migrations'

const setting = (value: string) => `'${value.replaceAll("'", '')}'`
const codeOf = (error: unknown): string | undefined => {
  const { cause, code } = (error ?? {}) as { cause?: unknown; code?: unknown }
  if (typeof code === 'string') {
    return code
  }
  return cause === undefined ? undefined : codeOf(cause)
}
const firstLine = (error: unknown) => (error instanceof Error ? error.message.split('\n', 1)[0] : String(error))

const log = (
  level: 'info' | 'error',
  msg: string,
  fields: Readonly<Record<string, string | number | undefined>> = {},
) =>
  (level === 'error' ? process.stderr : process.stdout).write(
    `${JSON.stringify({ level, msg, time: new Date().toISOString(), ...fields })}\n`,
  )

if (existsSync('.env') && !process.env.MIGRATION_DATABASE_URL && !process.env.DATABASE_URL) {
  process.loadEnvFile('.env')
}
const url = process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL
if (!url) {
  log('error', 'MIGRATION_DATABASE_URL or DATABASE_URL is required')
  process.exit(2)
}
const migrationsFolder = process.env.MIGRATIONS_FOLDER ?? 'drizzle'
if (!existsSync(`${migrationsFolder}/meta/_journal.json`)) {
  log('error', 'migrations folder not found', { migrationsFolder })
  process.exit(2)
}
const migrations = readMigrationFiles({ migrationsFolder })

class LockWaitExceededError extends Error {}

type Migration = (typeof migrations)[number]
type Counts = { applied: number; total: number }

const relaxTimeouts = async (client: Client) => {
  await client.query('set local statement_timeout = 0')
  await client.query('set local idle_in_transaction_session_timeout = 0')
}

const takeLock = async (client: Client) => {
  await client.query(`set local lock_timeout = ${setting(LOCK_WAIT)}`)
  await client.query('select pg_advisory_xact_lock($1)', [LOCK_KEY]).catch((error: unknown) => {
    throw codeOf(error) === LOCK_NOT_AVAILABLE
      ? new LockWaitExceededError(`another migration run held the lock for longer than ${LOCK_WAIT}`, { cause: error })
      : error
  })
}

const pendingMigrations = async (client: Client): Promise<Array<Migration>> => {
  const { rows } = await client.query<{ created_at: string | null }>(
    `select created_at from ${TABLE} order by created_at desc limit 1`,
  )
  const last = rows[0]?.created_at
  return migrations.filter((migration) => last === null || last === undefined || Number(last) < migration.folderMillis)
}

const applyMigration = async (client: Client, migration: Migration) => {
  for (const statement of migration.sql) {
    await client.query(statement)
  }
  await client.query(`insert into ${TABLE} (hash, created_at) values ($1, $2)`, [
    migration.hash,
    migration.folderMillis,
  ])
}

const applyPending = async (client: Client): Promise<Counts> => {
  await client.query(`set local lock_timeout = ${setting(DDL_LOCK_WAIT)}`)
  await client.query('create schema if not exists drizzle')
  await client.query(
    `create table if not exists ${TABLE} (id serial primary key, hash text not null, created_at bigint)`,
  )
  const pending = await pendingMigrations(client)
  for (const migration of pending) {
    await applyMigration(client, migration)
  }
  const total = (await client.query<{ n: number }>(`select count(*)::int as n from ${TABLE}`)).rows[0]?.n ?? 0
  return { applied: pending.length, total }
}

const attempt = async (client: Client): Promise<Counts> => {
  await client.query('begin')
  try {
    await relaxTimeouts(client)
    await takeLock(client)
    const counts = await applyPending(client)
    await client.query('commit')
    return counts
  } catch (error) {
    await client.query('rollback').catch(() => {})
    throw error
  }
}

const retriable = (error: unknown, attemptNumber: number) =>
  !(error instanceof LockWaitExceededError) && codeOf(error) === LOCK_NOT_AVAILABLE && attemptNumber < DDL_ATTEMPTS

const migrateWithRetries = async (client: Client, attemptNumber = 1): Promise<Counts> => {
  try {
    return await attempt(client)
  } catch (error) {
    if (!retriable(error, attemptNumber)) {
      throw error
    }
    const lockTimeout = DDL_LOCK_WAIT
    log('info', 'migration waited too long for a table lock, retrying', { attempt: attemptNumber, lockTimeout })
    await delay(1000 * attemptNumber)
    return migrateWithRetries(client, attemptNumber + 1)
  }
}

const client = new Client({
  application_name: 'app-migrate',
  connectionString: url,
  connectionTimeoutMillis: 10_000,
})
client.on('notice', () => {})
const started = performance.now()
try {
  await client.connect()
  const { applied, total } = await migrateWithRetries(client)
  log('info', 'migrations applied', { applied, ms: Math.round(performance.now() - started), total })
} catch (error) {
  const cause = error instanceof Error && error.cause !== undefined ? firstLine(error.cause) : undefined
  log('error', 'migration failed', { cause, code: codeOf(error), error: firstLine(error) })
  process.exitCode = 1
} finally {
  await client.end().catch(() => {})
}
