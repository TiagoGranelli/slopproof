import '@tanstack/react-start/server-only'
import { Data, Effect } from 'effect'
import { Database } from './client.ts'
import type { Db } from './client.ts'

export class DbError extends Data.TaggedError('DbError')<{ readonly cause: unknown }> {}

export const query = <A>(own: Db, run: (db: Db) => Promise<A>): Effect.Effect<A, DbError> =>
  Effect.flatMap(Database.client(own), (db) =>
    Effect.tryPromise({ catch: (cause) => new DbError({ cause }), try: () => run(db) }),
  )

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const isUuid = (id: string): boolean => UUID.test(id)
