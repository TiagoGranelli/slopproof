import { PgDatabase, PgTransaction } from 'drizzle-orm/pg-core'
import { Cause, Data, Effect, Exit } from 'effect'
import { describe, expect, it } from 'vitest'
import { Database } from '#/server/db/client.ts'
import type { Db } from '#/server/db/client.ts'

class Refused extends Data.TaggedError('Refused') {}

const fakeDb = (transaction: <T>(body: (client: Db) => Promise<T>) => Promise<T>): Db =>
  Object.assign(Object.create(PgDatabase.prototype) as Db, { transaction })

const fakeDriver = () => {
  const log: Array<string> = []
  const tx = Object.create(PgTransaction.prototype) as Db
  const own = fakeDb(async (body) => {
    log.push('begin')
    try {
      const returned = await body(tx)
      log.push('commit')
      return returned
    } catch (error) {
      log.push('rollback')
      throw error
    }
  })
  return { log, own, tx }
}

const run = <A, E>(own: Db, effect: Effect.Effect<A, E, Database>) =>
  Effect.runPromiseExit(effect.pipe(Effect.provideService(Database, own)))

describe('Database.transaction', () => {
  it('gives the body the transaction as Database and as the client of a repository built outside it', async () => {
    const { log, own, tx } = fakeDriver()
    const seen = await run(
      own,
      Database.transaction(
        Effect.gen(function* () {
          return [yield* Database, yield* Database.client(own)]
        }),
      ),
    )
    expect(seen).toEqual(Exit.succeed([tx, tx]))
    expect(log).toEqual(['begin', 'commit'])
    expect(await Effect.runPromise(Database.client(own))).toBe(own)
  })

  it('rolls back and keeps the typed error; a driver failure is a defect', async () => {
    const { log, own } = fakeDriver()
    expect(await run(own, Database.transaction(Effect.fail(new Refused())))).toEqual(Exit.fail(new Refused()))
    expect(log).toEqual(['begin', 'rollback'])
    const broken = fakeDb(async () => {
      throw new Error('connection refused')
    })
    const exit = await run(broken, Database.transaction(Effect.succeed(1)))
    expect(Exit.isFailure(exit) && Cause.hasDies(exit.cause)).toBe(true)
  })

  it('joins a transaction it is already in', async () => {
    const { log, own } = fakeDriver()
    await run(own, Database.transaction(Database.transaction(Effect.void)))
    expect(log).toEqual(['begin', 'commit'])
  })
})
