import { HttpApi } from 'effect/http-api'
import { Api } from '#/contract/api.ts'

interface Operation {
  readonly errorStatuses: ReadonlySet<number>
  readonly method: string
  readonly name: string
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

const MISSING_ID = '00000000-0000-4000-8000-000000000000'

const VALID_PAYLOAD = { body: 'hello' }

export const requestFor = (operation: Operation, headers: Record<string, string> = {}): Request =>
  new Request(`http://localhost:3000${operation.path.replaceAll(/:\w+/g, MISSING_ID)}`, {
    body: operation.method === 'POST' || operation.method === 'PATCH' ? JSON.stringify(VALID_PAYLOAD) : null,
    headers: { 'content-type': 'application/json', ...headers },
    method: operation.method,
  })
