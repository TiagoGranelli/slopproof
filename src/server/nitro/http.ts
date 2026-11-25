import { definePlugin } from 'nitro'
import { env } from '../env.ts'
import { isDraining } from '../lifecycle.ts'
import { log } from '../log.ts'

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

const QUIET = /^\/(api\/(health|ready)$|assets\/|favicon)/
const started = new WeakMap<object, number>()
const CLIENT_CLOSED = 499

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

const logRequest = (response: Response, event: Event) => {
  const path = new URL(event.req.url).pathname
  const aborted = event.req.signal.aborted
  const status = aborted ? CLIENT_CLOSED : response.status
  if (QUIET.test(path) && status < 400) {
    return
  }
  const since = started.get(event)
  log(status >= 500 ? 'error' : 'info', 'request', {
    aborted: aborted || undefined,
    method: event.req.method,
    ms: since === undefined ? undefined : Math.round(performance.now() - since),
    path,
    status,
  })
}

export default definePlugin((nitroApp) => {
  const production = process.env.NODE_ENV === 'production'

  nitroApp.hooks.hook('request', (event) => {
    started.set(event, performance.now())
    // Touching event.req.signal arms srvx's lazy abort signal for 499 logging.
    // oxlint-disable-next-line typescript/no-meaningless-void-operator
    void event.req.signal
  })

  nitroApp.hooks.hook('response', (response, event) => {
    if (isDraining()) {
      response.headers.set('connection', 'close')
    }
    if (production) {
      addSecurityHeaders(response.headers)
    }
    logRequest(response, event)
  })
})
