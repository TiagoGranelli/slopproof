import '@tanstack/react-start/server-only'
import type { ExtractTablesWithRelations } from 'drizzle-orm'
import { drizzle, type NodePgQueryResultHKT } from 'drizzle-orm/node-postgres'
import type { PgDatabase } from 'drizzle-orm/pg-core'
import { Context, Effect, Exit, Layer, Option, Redacted } from 'effect'
import { Pool, type PoolConfig } from 'pg'
import { env } from '../env.ts'
import { onShutdown } from '../lifecycle.ts'
import { log } from '../log.ts'
import * as schema from './schema/index.ts'

const poolConfig: PoolConfig = {
  application_name: 'app',
  connectionString: Redacted.value(env.databaseUrl),
  connectionTimeoutMillis: 5000,
  idleTimeoutMillis: 10_000,
  max: env.databasePoolMax,
}
if (!env.databaseUrlPooled) {
  poolConfig.idle_in_transaction_session_timeout = 30_000
  poolConfig.statement_timeout = 15_000
}

export const pool = new Pool(poolConfig)
pool.on('error', (error) => log('error', 'postgres pool error', { error }))
onShutdown('postgres-pool', () => pool.end())

export const db = drizzle({ client: pool, schema })

export type Db = PgDatabase<NodePgQueryResultHKT, typeof schema, ExtractTablesWithRelations<typeof schema>>

const isTransaction = (database: Db): boolean => 'rollback' in database

class RollbackError extends Error {
  readonly exit: Exit.Exit<unknown, unknown>
  constructor(exit: Exit.Exit<unknown, unknown>) {
    super('transaction rolled back')
    this.exit = exit
  }
}

export class Database extends Context.Service<Database, Db>()('app/Database') {
  static readonly layer = Layer.succeed(Database, db)

  static readonly client = (own: Db): Effect.Effect<Db> =>
    Effect.map(
      Effect.serviceOption(Database),
      Option.getOrElse(() => own),
    )

  static readonly transaction = <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R | Database> =>
    Effect.gen(function* () {
      const database = yield* Database
      if (isTransaction(database)) {
        return yield* effect
      }
      const context = yield* Effect.context<R>()
      return yield* Effect.callback<A, E>((resume) => {
        const controller = new AbortController()
        const settled = transactionExit(database, (tx) =>
          Effect.runPromiseExitWith(Context.add(context, Database, tx))(effect, { signal: controller.signal }),
        )
        void settled.then(resume)
        return Effect.promise(() => {
          controller.abort()
          return settled
        }).pipe(Effect.asVoid)
      })
    })
}

const transactionExit = <A, E>(database: Db, body: (tx: Db) => Promise<Exit.Exit<A, E>>): Promise<Exit.Exit<A, E>> =>
  database
    .transaction(async (tx) => {
      const exit = await body(tx)
      if (Exit.isFailure(exit)) {
        throw new RollbackError(exit)
      }
      return exit
    })
    .catch((error: unknown) => (error instanceof RollbackError ? (error.exit as Exit.Exit<A, E>) : Exit.die(error)))
