import { isNotFound, isRedirect } from '@tanstack/react-router'
import { createMiddleware } from '@tanstack/react-start'
import { log } from '#/server/log.ts'

/**
 * Global function middleware (src/start.ts): runs around every server function, whether the browser calls
 * it or SSR does. Start serializes whatever a server function throws to the client, message included, so a
 * raw Better Auth or database error would reach the browser with its SQL and parameters. Redirects and
 * not-found pass through untouched; any other error is logged through `log` (first line, stack frames,
 * no parameters) and replaced by a generic error.
 */
export const serverFunctionErrors = createMiddleware({ type: 'function' }).server(async ({ next, serverFnMeta }) => {
  try {
    return await next()
  } catch (error) {
    if (isRedirect(error) || isNotFound(error)) throw error
    log('error', 'server function failed', { fn: serverFnMeta.name, error })
    // No `cause` on purpose: the original error stays on the server, in the log line above.
    // oxlint-disable-next-line preserve-caught-error
    throw new Error('Internal error')
  }
})

/**
 * Global request middleware (src/start.ts) for the server-function errors Start throws before the function and
 * its middleware run: an unknown or unresolved id (`Server function info not found for <id>`) or a payload it
 * cannot read. Since Start 1.169 these are serialized to the client with their message, which echoes the id the
 * client sent and names Start's internals. Logged here and replaced by the same generic error as above.
 */
export const serverFunctionRequestErrors = createMiddleware().server(async ({ next, handlerType, pathname }) => {
  if (handlerType !== 'serverFn') return next()
  try {
    return await next()
  } catch (error) {
    if (error instanceof Response || isRedirect(error) || isNotFound(error)) throw error
    log('error', 'server function request failed', { path: pathname, error })
    // No `cause` on purpose: Start serializes the thrown error to the client; the original stays in the log.
    // oxlint-disable-next-line preserve-caught-error
    throw new Error('Internal error')
  }
})
