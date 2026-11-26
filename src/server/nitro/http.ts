import { createHash, timingSafeEqual } from 'node:crypto'
import { Redacted } from 'effect'
import { definePlugin } from 'nitro'
import { env } from '../env.ts'
import { isFlagEnabled } from '../feature-flags.ts'
import { isDraining } from '../lifecycle.ts'
import { log } from '../log.ts'
import { recordHttpRequest, renderPrometheusMetrics } from '../observability/telemetry.ts'
import { currentRequestContext, runWithRequestContext } from '../request-context.ts'

const https = env.appUrl.startsWith('https://')

const baselineHeaders = Object.entries({
  'cross-origin-opener-policy': 'same-origin',
  'cross-origin-resource-policy': 'same-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
})
if (https) {
  baselineHeaders.push(['strict-transport-security', 'max-age=63072000; includeSubDomains'])
}

const LOCKED_DOWN_CSP = "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"

const QUIET = /^\/(api\/(health|ready)$|assets\/|favicon|metrics$)/
const started = new WeakMap<object, number>()
const CLIENT_CLOSED = 499
const PROMETHEUS_CONTENT_TYPE = 'text/plain; version=0.0.4; charset=utf-8'

type Event = { req: Request }

const addSecurityHeaders = (headers: Headers) => {
  for (const [name, value] of baselineHeaders) {
    if (!headers.has(name)) {
      headers.set(name, value)
    }
  }
  const csp = headers.get('content-security-policy')
  if (!csp) {
    headers.set('content-security-policy', LOCKED_DOWN_CSP)
  } else if (https) {
    headers.set('content-security-policy', `${csp}; upgrade-insecure-requests`)
  }
}

const attachCorrelationHeaders = (headers: Headers) => {
  const context = currentRequestContext()
  if (!context) {
    return
  }
  headers.set('x-request-id', context.requestId)
  headers.set('traceparent', context.traceparent)
}

const sha256 = (value: string): Buffer => createHash('sha256').update(value).digest()

const isValidBearerToken = (header: string | null, expected: string): boolean => {
  if (!header?.startsWith('Bearer ')) {
    return false
  }
  const provided = header.slice(7).trim()
  return provided.length > 0 && timingSafeEqual(sha256(provided), sha256(expected))
}

const buildMetricsResponse = (request: Request): Response => {
  if (!isFlagEnabled('prometheusMetrics') || !env.metricsToken) {
    return new Response(null, { headers: { 'cache-control': 'no-store' }, status: 404 })
  }
  if (!isValidBearerToken(request.headers.get('authorization'), Redacted.value(env.metricsToken))) {
    return new Response(null, {
      headers: { 'cache-control': 'no-store', 'www-authenticate': 'Bearer' },
      status: 401,
    })
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response(null, { headers: { allow: 'GET, HEAD', 'cache-control': 'no-store' }, status: 405 })
  }
  const body = request.method === 'HEAD' ? null : renderPrometheusMetrics()
  return new Response(body, {
    headers: { 'cache-control': 'no-store', 'content-type': PROMETHEUS_CONTENT_TYPE },
    status: 200,
  })
}

const handleMetricsRequest = (request: Request, production: boolean): Response => {
  const response = buildMetricsResponse(request)
  if (isDraining()) {
    response.headers.set('connection', 'close')
  }
  if (production) {
    addSecurityHeaders(response.headers)
  }
  attachCorrelationHeaders(response.headers)
  if (response.status >= 400) {
    log('info', 'request', { method: request.method, path: '/metrics', status: response.status })
  }
  return response
}

const logRequest = (response: Response, event: Event) => {
  const path = new URL(event.req.url).pathname
  const aborted = event.req.signal.aborted
  const status = aborted ? CLIENT_CLOSED : response.status
  const since = started.get(event)
  const ms = since === undefined ? undefined : Math.round(performance.now() - since)
  recordHttpRequest({ durationMs: ms ?? 0, method: event.req.method, route: path, status })
  if (QUIET.test(path) && status < 400) {
    return
  }
  log(status >= 500 ? 'error' : 'info', 'request', {
    aborted: aborted || undefined,
    method: event.req.method,
    ms,
    path,
    status,
  })
}

const finalizeResponse = (response: Response, event: Event, production: boolean) => {
  if (isDraining()) {
    response.headers.set('connection', 'close')
  }
  if (production) {
    addSecurityHeaders(response.headers)
  }
  attachCorrelationHeaders(response.headers)
  logRequest(response, event)
}

export default definePlugin((nitroApp) => {
  const production = process.env.NODE_ENV === 'production'
  const baseFetch = nitroApp.fetch
  nitroApp.fetch = (request: Request) =>
    runWithRequestContext(request.headers, () =>
      new URL(request.url).pathname === '/metrics' ? handleMetricsRequest(request, production) : baseFetch(request),
    )

  nitroApp.hooks.hook('request', (event) => {
    started.set(event, performance.now())
    // Touching event.req.signal arms srvx's lazy abort signal for 499 logging.
    // oxlint-disable-next-line typescript/no-meaningless-void-operator
    void event.req.signal
  })

  nitroApp.hooks.hook('response', (response, event) => finalizeResponse(response, event, production))
})
