// Every operation of the contract, read from it with HttpApi.reflect, and a valid request for each: the tests that
// check all operations alike (./database-down.test.ts, ./public-operations.test.ts) cover a new endpoint without an
// edit.
import { HttpApi } from 'effect/http-api'
import { Api } from '#/contract/api.ts'

interface Operation {
  /** The error statuses the operation declares, its middleware's included. */
  readonly errorStatuses: ReadonlySet<number>
  readonly method: string
  /** `<group>.<endpoint>`, as the typed client names it: `myPosts.update`. */
  readonly name: string
  /** The contract's path, with `:param` placeholders: `/api/me/posts/:id`. */
  readonly path: string
}

const collected: Array<Operation> = []
HttpApi.reflect(Api, {
  onEndpoint: ({ endpoint, errors, group }) =>
    collected.push({
      errorStatuses: new Set(errors.keys()),
      method: endpoint.method,
      name: `${group.identifier}.${endpoint.identifier}`,
      path: endpoint.path,
    }),
  onGroup: () => {},
})
export const operations: ReadonlyArray<Operation> = collected

/** A well-formed id that no row has: a path parameter that decodes, so only the test's subject can fail. */
const MISSING_ID = '00000000-0000-4000-8000-000000000000'

/**
 * A payload every write of the contract accepts today (PostInput). An endpoint that takes another payload gets its
 * own here, or the tests see a 400 where they expect the database or the session to decide.
 */
const VALID_PAYLOAD = { body: 'hello' }

/** A valid request for `operation`, with `headers` (a session cookie, say) on top of the JSON content type. */
export const requestFor = (operation: Operation, headers: Record<string, string> = {}): Request =>
  new Request(`http://localhost:3000${operation.path.replaceAll(/:\w+/g, MISSING_ID)}`, {
    body: operation.method === 'POST' || operation.method === 'PATCH' ? JSON.stringify(VALID_PAYLOAD) : null,
    headers: { 'content-type': 'application/json', ...headers },
    method: operation.method,
  })
