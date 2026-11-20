import { describe, expect, it, onTestFinished } from '@effect/vitest'
import { webHandler } from './harness.ts'
import { operations, requestFor } from './operations.ts'

const PUBLIC_OPERATIONS = new Set(['GET /api/health', 'GET /api/ready', 'GET /api/posts'])

const keyOf = (operation: { method: string; path: string }) => `${operation.method} ${operation.path}`
const keyed = operations.map((operation) => ({ key: keyOf(operation), operation }))

describe('without a session', () => {
  it('lists only operations the contract has', () => {
    const known = new Set(keyed.map(({ key }) => key))
    expect([...PUBLIC_OPERATIONS].filter((key) => !known.has(key))).toEqual([])
  })

  it.each(keyed.filter(({ key }) => !PUBLIC_OPERATIONS.has(key)))(
    '$key answers 401 (behind the Authentication middleware; if it is public by design, add it to PUBLIC_OPERATIONS)',
    async ({ operation }) => {
      const { dispose, handler } = webHandler()
      onTestFinished(dispose)
      const response = await handler(requestFor(operation))
      expect(response.status).toBe(401)
    },
  )
})
