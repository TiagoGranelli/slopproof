import { spawnSync } from 'node:child_process'
import { Client } from 'pg'
import { afterAll, describe, expect, it } from 'vitest'
import { dropTestDatabase, emptyTestDatabase, testDatabaseUrl } from '../../scripts/test-db.ts'

const url = testDatabaseUrl('sweep')
const named = (name: string) => Object.assign(new URL(url), { pathname: `/${name}` }).toString()

const exitedPid = () => {
  const { pid } = spawnSync(process.execPath, ['--eval', ''])
  if (!pid) {
    throw new Error('node --eval did not start')
  }
  return pid
}

const admin = async <T>(work: (client: Client) => Promise<T>) => {
  const client = new Client({ connectionString: named('postgres') })
  await client.connect()
  try {
    return await work(client)
  } finally {
    await client.end()
  }
}
const existing = (names: Array<string>) =>
  admin(async (client) => {
    const { rows } = await client.query<{ datname: string }>(
      'select datname from pg_database where datname = any($1) order by 1',
      [names],
    )
    return rows.map((row) => row.datname)
  })

const abandoned = `app_sweep_${exitedPid()}_test`
const running = `app_sweep_${process.ppid}_test`
const fixed = 'app_fixed_sweep_test'

afterAll(async () => {
  for (const name of [abandoned, running, fixed, new URL(url).pathname.slice(1)]) {
    await dropTestDatabase(named(name))
  }
})

describe('emptyTestDatabase', () => {
  it("drops the databases of runs that are gone, and nobody else's", async () => {
    await emptyTestDatabase(named(running))
    await emptyTestDatabase(named(fixed))
    await admin((client) => client.query(`create database "${abandoned}"`))

    await emptyTestDatabase(url)
    expect(await existing([abandoned, running, fixed])).toEqual([fixed, running].toSorted())
  })
})
