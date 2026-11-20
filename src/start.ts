import { createCsrfMiddleware, createMiddleware, createStart } from '@tanstack/react-start'
import { appOrigin } from '#/lib/app-origin.ts'
import { serverFunctionErrors, serverFunctionRequestErrors } from '#/lib/server-function-errors.ts'

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])
const MAX_BODY_BYTES = 64 * 1024

const csrf = createCsrfMiddleware({
  filter: ({ request }) => !SAFE_METHODS.has(request.method),
  origin: (value) => value === appOrigin(),
})

const bodyLimit = createMiddleware().server(({ next, request }) => {
  if (SAFE_METHODS.has(request.method)) {
    return next()
  }
  const length = request.headers.get('content-length')
  if (length === null) {
    return request.headers.has('transfer-encoding') ? new Response(null, { status: 411 }) : next()
  }
  if (!/^\d+$/.test(length)) {
    return new Response(null, { status: 400 })
  }
  if (Number(length) > MAX_BODY_BYTES) {
    return new Response(null, { status: 413 })
  }
  return next()
})

export const startInstance = createStart(() => ({
  functionMiddleware: [serverFunctionErrors],
  requestMiddleware: [serverFunctionRequestErrors, csrf, bodyLimit],
}))
