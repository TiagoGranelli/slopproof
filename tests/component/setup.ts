import { afterAll, afterEach, beforeAll, expect } from 'vitest'
import { releaseHeld, worker } from './api-mocks.ts'

const unhandled: Array<string> = []

const frameRequest = (data: unknown): Request | undefined =>
  // A web Request has no brand to check but its class.
  // oxlint-disable-next-line @nkzw/no-instanceof
  typeof data === 'object' && data !== null && 'request' in data && data.request instanceof Request
    ? data.request
    : undefined

beforeAll(async () => {
  await worker.start({
    onUnhandledFrame: ({ frame }) => {
      const request = frameRequest(frame.data)
      if (!request) {
        return
      }
      const url = new URL(request.url)
      if (/^\/(api|_serverFn)\//.test(url.pathname)) {
        unhandled.push(`${request.method} ${url.pathname}`)
      }
    },
    quiet: true,
  })
})

afterEach(() => {
  releaseHeld()
  worker.resetHandlers()
  const missing = unhandled.splice(0)
  expect(missing, 'requests without an MSW handler (add one with worker.use)').toEqual([])
})

afterAll(() => worker.stop())
