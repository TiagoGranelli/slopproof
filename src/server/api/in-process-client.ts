import '@tanstack/react-start/server-only'
import { getRequestHeader } from '@tanstack/react-start/server'
import { type Client, createClient } from '#/sdk/client/index.ts'
import { env } from '../env.ts'
import { apiHandler } from './web-handler.ts'

const dispatch = (request: Request): Promise<Response> => {
  if (request.method !== 'GET') {
    throw new Error(
      `The in-process API client only sends GET (got ${request.method} ${new URL(request.url).pathname}): ` +
        'call a write from the browser, where the CSRF check applies.',
    )
  }
  return apiHandler(request)
}

export const createInProcessApiClient = (): Client => {
  const cookie = getRequestHeader('cookie')
  return createClient({
    baseUrl: env.appUrl,
    fetch: (input, init) => dispatch(new Request(input, init)),
    headers: cookie ? { cookie } : undefined,
  })
}
