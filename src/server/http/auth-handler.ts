import '@tanstack/react-start/server-only'
import { appendResponseHeader, getRequestHeaders, getRequestIP } from '@tanstack/react-start/server'
import type { BASE_ERROR_CODES } from 'better-auth'
import { Redacted } from 'effect'
import { UserId } from '#/contract/ids.ts'
import type { Json } from '#/contract/json.ts'
import { recordAuditEvent } from '../audit/audit-log.ts'
import { auth } from '../auth.ts'
import { finishBeforeShutdown } from '../background-tasks.ts'
import { db } from '../db/client.ts'
import type { AuditOutcome } from '../db/schema/audit-log.ts'
import { env } from '../env.ts'
import { isFlagEnabled } from '../feature-flags.ts'
import { log } from '../log.ts'
import { recordAuthEvent } from '../observability/telemetry.ts'
import { AUTH_BASE_PATH, isHttpEndpoint, notFound } from './auth-endpoints.ts'
import { forwardedFor } from './forwarded-for.ts'

const withPeerAddress = (source: Headers): Headers => {
  const headers = new Headers(source)
  const chain = forwardedFor(headers.get('x-forwarded-for'), getRequestIP(), env.trustedProxies.length > 0)
  if (chain) {
    headers.set('x-forwarded-for', chain)
  } else {
    headers.delete('x-forwarded-for')
  }
  return headers
}

const dispatch = async (request: Request): Promise<Response> => {
  try {
    return await finishBeforeShutdown(auth.handler(request))
  } catch (error) {
    log('error', 'auth request failed', { error, path: new URL(request.url).pathname })
    return new Response(null, { headers: { 'cache-control': 'no-store' }, status: 500 })
  }
}

const BETTER_AUTH_CODES = [
  'INVALID_ORIGIN',
  'MISSING_OR_NULL_ORIGIN',
  'CROSS_SITE_NAVIGATION_LOGIN_BLOCKED',
  'VALIDATION_ERROR',
  'INVALID_EMAIL',
  'INVALID_EMAIL_OR_PASSWORD',
  'EMAIL_NOT_VERIFIED',
  'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL',
  'FAILED_TO_CREATE_USER',
  'FAILED_TO_CREATE_SESSION',
  'PASSWORD_TOO_SHORT',
  'PASSWORD_TOO_LONG',
  'INVALID_TOKEN',
  'TOKEN_EXPIRED',
  'USER_NOT_FOUND',
  'INVALID_USER',
  'EMAIL_MISMATCH',
  'EMAIL_ALREADY_VERIFIED',
  'SESSION_NOT_FRESH',
  'SESSION_EXPIRED',
  'INVALID_PASSWORD',
  'CREDENTIAL_ACCOUNT_NOT_FOUND',
  'FAILED_TO_GET_SESSION',
] as const satisfies ReadonlyArray<keyof typeof BASE_ERROR_CODES>

export type AuthErrorCode = (typeof BETTER_AUTH_CODES)[number] | 'UNAUTHORIZED'

const KNOWN_CODES: ReadonlySet<string> = new Set<AuthErrorCode>([...BETTER_AUTH_CODES, 'UNAUTHORIZED'])
const isKnownCode = (code: string): code is AuthErrorCode => KNOWN_CODES.has(code)

export type AuthEndpointResult =
  | { readonly body: Json | undefined; readonly ok: true }
  | {
      readonly code: AuthErrorCode | undefined
      readonly ok: false
      readonly retryAfter: number | undefined
      readonly status: number
    }

const codeOf = (body: Json | undefined, path: string): AuthErrorCode | undefined => {
  const code =
    typeof body === 'object' && body !== null && 'code' in body && typeof body.code === 'string' ? body.code : undefined
  if (code === undefined || isKnownCode(code)) {
    return code
  }
  log('warn', 'unknown Better Auth error code', { code, path })
  return undefined
}

const parseJson = (text: string): Json | undefined => {
  try {
    // JSON.parse returns any; every value it can produce is a Json.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    return JSON.parse(text) as Json
  } catch {
    return undefined
  }
}

type EndpointInput = { readonly body?: JsonObject; readonly query?: Record<string, string> }

const endpointRequest = (method: 'GET' | 'POST', path: `/${string}`, input: EndpointInput): Request => {
  const url = new URL(`${AUTH_BASE_PATH}${path}`, env.appUrl)
  for (const [name, value] of Object.entries(input.query ?? {})) {
    url.searchParams.set(name, value)
  }
  const headers = withPeerAddress(new Headers(getRequestHeaders()))
  for (const name of ['content-length', 'content-type', 'transfer-encoding']) {
    headers.delete(name)
  }
  const init: RequestInit = { headers, method }
  if (input.body) {
    headers.set('content-type', 'application/json')
    init.body = JSON.stringify(input.body)
  }
  return new Request(url, init)
}

const readOutcome = async (response: Response, path: string): Promise<AuthEndpointResult> => {
  const body = parseJson(await response.text())
  if (response.ok) {
    return { body, ok: true }
  }
  const retryAfter = Number(response.headers.get('x-retry-after'))
  return {
    code: codeOf(body, path),
    ok: false,
    retryAfter: Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined,
    status: response.status,
  }
}

const authAuditOutcome = (response: Response): AuditOutcome => {
  if (response.ok) {
    return 'success'
  }
  if (response.status === 401 || response.status === 403 || response.status === 429) {
    return 'denied'
  }
  return 'failure'
}

const auditActorId = (ok: boolean, body: Json | undefined): UserId | null => {
  if (!ok || !isJsonObject(body) || !isJsonObject(body.user) || typeof body.user.id !== 'string') {
    return null
  }
  return UserId.make(body.user.id)
}

const lastForwardedIp = (headers: Headers): string | undefined =>
  headers
    .get('x-forwarded-for')
    ?.split(',')
    .map((entry) => entry.trim())
    .toReversed()
    .find((entry) => entry.length > 0)

const auditableAuthPath = (request: Request): string | undefined => {
  const pathname = new URL(request.url).pathname
  const subPath = pathname.startsWith(AUTH_BASE_PATH) ? pathname.slice(AUTH_BASE_PATH.length) : pathname
  if (subPath === '/get-session' || (request.method === 'GET' && subPath !== '/verify-email')) {
    return undefined
  }
  return subPath
}

const buildAuthAuditInput = (request: Request, response: Response, body: Json | undefined) => {
  const subPath = auditableAuthPath(request)
  if (!subPath) {
    return undefined
  }
  return {
    action: `auth.${subPath.replace(/^\/+/, '').replaceAll('/', '.')}`,
    actorId: auditActorId(response.ok, body),
    ip: lastForwardedIp(request.headers),
    ipSalt: env.auditIpSalt ? Redacted.value(env.auditIpSalt) : undefined,
    metadata: { method: request.method, path: subPath, statusCode: response.status },
    outcome: authAuditOutcome(response),
  }
}

const recordAuthAudit = async (request: Request, response: Response, body: Json | undefined): Promise<void> => {
  const event = buildAuthAuditInput(request, response, body)
  if (!event) {
    return
  }
  recordAuthEvent(event.action, event.outcome)
  await finishBeforeShutdown(recordAuditEvent(db, event, { strict: isFlagEnabled('auditLogStrict') }))
}

export const callAuthEndpoint = async (
  method: 'GET' | 'POST',
  path: `/${string}`,
  input: EndpointInput = {},
): Promise<AuthEndpointResult> => {
  const request = endpointRequest(method, path, input)
  const response = await dispatch(request)
  const cookies = response.headers.getSetCookie()
  if (cookies.length > 0) {
    appendResponseHeader('set-cookie', cookies)
  }
  const outcome = await readOutcome(response, path)
  await recordAuthAudit(request, response, outcome.ok ? outcome.body : undefined)
  return outcome
}

type JsonObject = { readonly [key: string]: Json }

const isJsonObject = (value: Json | undefined): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const withoutToken = (value: Json | undefined): Json | undefined => {
  if (!isJsonObject(value)) {
    return value
  }
  const rest = Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'token'))
  const { session } = value
  return isJsonObject(session) && 'token' in session ? { ...rest, session: withoutToken(session) ?? null } : rest
}

const withoutSessionTokens = async (
  response: Response,
): Promise<{ readonly body: Json | undefined; readonly response: Response }> => {
  if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) {
    return { body: undefined, response }
  }
  const parsed = parseJson(await response.text())
  const body = withoutToken(parsed)
  const headers = new Headers(response.headers)
  headers.delete('content-length')
  return {
    body: parsed,
    response: new Response(JSON.stringify(body), {
      headers,
      status: response.status,
      statusText: response.statusText,
    }),
  }
}

export const handleAuthRequest = async (request: Request): Promise<Response> => {
  if (!isHttpEndpoint(request)) {
    return notFound()
  }
  const hasBody = request.method !== 'GET' && request.method !== 'HEAD'
  const init = {
    body: hasBody ? request.body : null,
    duplex: 'half',
    headers: withPeerAddress(request.headers),
    method: request.method,
    signal: request.signal,
  }
  const forwarded = new Request(request.url, init)
  const rawResponse = await dispatch(forwarded)
  const sanitized = await withoutSessionTokens(rawResponse)
  await recordAuthAudit(forwarded, sanitized.response, sanitized.body)
  return sanitized.response
}
