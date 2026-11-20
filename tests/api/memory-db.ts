import { Effect } from 'effect'
import { DbError } from '#/server/db/query.ts'

export interface RepoOptions {
  readonly clockStepMicros?: number
  readonly databaseDown?: boolean
}

export const memoryQuery =
  (options: RepoOptions) =>
  <A>(run: () => A) =>
    options.databaseDown ? Effect.fail(new DbError({ cause: new Error('connect ECONNREFUSED') })) : Effect.sync(run)
