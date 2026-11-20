import { describe, expect, it, onTestFinished } from '@effect/vitest'
import { authors, webHandler } from './harness.ts'
import { operations, requestFor } from './operations.ts'

const expectedFor = (errorStatuses: ReadonlySet<number>) =>
  errorStatuses.has(503)
    ? { body: { _tag: 'ServiceUnavailable', message: 'Database unavailable' }, status: 503 }
    : { body: '', status: 500 }

const NO_DATABASE = new Map([
  ['me.get', { body: authors.alice, status: 200 }],
  ['system.health', { body: { status: 'ok' }, status: 200 }],
])

describe('with the database down', () => {
  it('lists in NO_DATABASE only operations the contract has', () => {
    const names = new Set(operations.map((op) => op.name))
    expect([...NO_DATABASE.keys()].filter((name) => !names.has(name))).toEqual([])
  })

  it.each(operations)('$name fails with its documented error', async (operation) => {
    const { dispose, handler } = webHandler({ databaseDown: true })
    onTestFinished(dispose)
    const response = await handler(requestFor(operation, { cookie: 'better-auth.session_token=alice' }))
    const text = await response.text()
    expect({ body: text ? (JSON.parse(text) as unknown) : '', status: response.status }).toEqual(
      NO_DATABASE.get(operation.name) ?? expectedFor(operation.errorStatuses),
    )
  })
})
