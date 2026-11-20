import { isNotFound, isRedirect } from '@tanstack/react-router'
import { createMiddleware } from '@tanstack/react-start'
import { log } from '#/server/log.ts'

export const serverFunctionErrors = createMiddleware({ type: 'function' }).server(async ({ next, serverFnMeta }) => {
  try {
    return await next()
  } catch (error) {
    if (isRedirect(error) || isNotFound(error)) {
      throw error
    }
    log('error', 'server function failed', { error, fn: serverFnMeta.name })
    // No `cause` on purpose: the original error stays on the server, in the log line above.
    // oxlint-disable-next-line preserve-caught-error
    throw new Error('Internal error')
  }
})

export const serverFunctionRequestErrors = createMiddleware().server(async ({ handlerType, next, pathname }) => {
  if (handlerType !== 'serverFn') {
    return next()
  }
  try {
    return await next()
  } catch (error) {
    // Start answers a thrown Response as it is; a web Response has no brand to check but its class.
    // oxlint-disable-next-line @nkzw/no-instanceof
    if (error instanceof Response || isRedirect(error) || isNotFound(error)) {
      throw error
    }
    log('error', 'server function request failed', { error, path: pathname })
    // No `cause` on purpose: Start serializes the thrown error to the client; the original stays in the log.
    // oxlint-disable-next-line preserve-caught-error
    throw new Error('Internal error')
  }
})
