import '@tanstack/react-start/server-only'
import type { BetterAuthPlugin } from 'better-auth'
import { env } from '../env.ts'

export const AUTH_BASE_PATH = '/api/auth'

type Endpoint = `${'GET' | 'POST'} /${string}`

const HTTP_ENDPOINTS = new Set<Endpoint>(['GET /get-session', 'POST /sign-in/email', 'POST /sign-out'])

const EXPOSED = new Set<Endpoint>([
  ...HTTP_ENDPOINTS,
  ...(env.authSignUp === 'open' ? (['POST /sign-up/email'] as const) : []),
  'POST /send-verification-email',
  'GET /verify-email',
  'POST /request-password-reset',
  'POST /reset-password',
  'POST /change-password',
  'GET /list-sessions',
  'POST /revoke-session',
  'POST /revoke-other-sessions',
  'POST /revoke-sessions',
  'POST /delete-user',
])

const endpointOf = (request: Request): string | undefined => {
  const { pathname } = new URL(request.url)
  return pathname.startsWith(`${AUTH_BASE_PATH}/`)
    ? `${request.method} ${pathname.slice(AUTH_BASE_PATH.length)}`
    : undefined
}

const has = (set: ReadonlySet<string>, endpoint: string | undefined) => endpoint !== undefined && set.has(endpoint)

export const isExposedEndpoint = (request: Request): boolean => has(EXPOSED, endpointOf(request))

export const isHttpEndpoint = (request: Request): boolean => has(HTTP_ENDPOINTS, endpointOf(request))

export const notFound = (): Response =>
  new Response('Not Found', { headers: { 'cache-control': 'no-store' }, status: 404 })

export const endpointAllowlist = (): BetterAuthPlugin => ({
  id: 'endpoint-allowlist',
  onRequest: async (request) => (isExposedEndpoint(request) ? undefined : { response: notFound() }),
  onResponse: async (response) => {
    if (response.headers.has('cache-control')) {
      return undefined
    }
    const headers = new Headers(response.headers)
    headers.set('cache-control', 'no-store')
    return {
      response: new Response(response.body, { headers, status: response.status, statusText: response.statusText }),
    }
  },
})
