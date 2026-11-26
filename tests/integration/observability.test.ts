import { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AuditMetadata } from '#/server/db/schema/audit-log.ts'
import { LOOPBACK, startApp } from '../../scripts/app-server.ts'
import type { RunningApp } from '../../scripts/app-server.ts'
import { dropTestDatabase, testDatabaseUrl } from '../../scripts/test-db.ts'
import { appUrl } from './helpers.ts'

const LOG_FILE = 'test-results/app-server-observability.log'
const METRICS_TOKEN = 'integration-metrics-token-123456'
const AUDIT_SALT = 'integration-audit-salt-123456'
const TRACEPARENT = /^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/

let observedApp: RunningApp
const databaseUrl = testDatabaseUrl('observability')

beforeAll(async () => {
  observedApp = await startApp({
    databaseUrl,
    logFile: LOG_FILE,
    settings: {
      AUDIT_IP_SALT: AUDIT_SALT,
      FEATURE_FLAGS: '{"prometheusMetrics":true}',
      METRICS_TOKEN,
    },
    trustedProxies: LOOPBACK,
  })
}, 60_000)

afterAll(async () => {
  await (observedApp as RunningApp | undefined)?.stop()
  await dropTestDatabase(databaseUrl)
})

describe('observability correlation and metrics', () => {
  it('mints and propagates x-request-id and W3C traceparent headers', async () => {
    const generated = await fetch(`${observedApp.directUrl}/api/health`)
    expect(generated.status).toBe(200)
    expect(generated.headers.get('x-request-id')).toBeTruthy()
    expect(generated.headers.get('traceparent')).toMatch(TRACEPARENT)

    const traceId = '4bf92f3577b34da6a3ce929d0e0e4736'
    const parentSpanId = '00f067aa0ba902b7'
    const propagated = await fetch(`${observedApp.directUrl}/api/health`, {
      headers: {
        traceparent: `00-${traceId}-${parentSpanId}-01`,
        'x-request-id': 'obs-trace-1',
      },
    })
    expect(propagated.headers.get('x-request-id')).toBe('obs-trace-1')
    const outTraceparent = propagated.headers.get('traceparent') ?? ''
    expect(outTraceparent).toMatch(new RegExp(`^00-${traceId}-[0-9a-f]{16}-01$`))
    expect(outTraceparent).not.toContain(`-${parentSpanId}-`)
  })

  it('returns 404 on /metrics when disabled on the default server', async () => {
    const disabled = await fetch(`${appUrl}/metrics`)
    expect(disabled.status).toBe(404)
  })

  it('guards /metrics with Bearer token and serves Prometheus exposition when enabled', async () => {
    const missing = await fetch(`${observedApp.directUrl}/metrics`)
    const wrong = await fetch(`${observedApp.directUrl}/metrics`, {
      headers: { authorization: 'Bearer wrong-token-123456' },
    })
    const methodDenied = await fetch(`${observedApp.directUrl}/metrics`, {
      headers: { authorization: `Bearer ${METRICS_TOKEN}` },
      method: 'POST',
    })
    const allowed = await fetch(`${observedApp.directUrl}/metrics`, {
      headers: { authorization: `Bearer ${METRICS_TOKEN}` },
    })
    expect(missing.status).toBe(401)
    expect(wrong.status).toBe(401)
    expect(methodDenied.status).toBe(405)
    expect(allowed.status).toBe(200)
    expect(allowed.headers.get('content-type')).toContain('text/plain; version=0.0.4')
    expect(allowed.headers.get('cache-control')).toBe('no-store')
    const body = await allowed.text()
    expect(body).toContain('http_requests_total')
    expect(body).toContain('http_request_duration_ms')
  })

  it('records sanitized auth audit events in Postgres and increments auth_events_total', async () => {
    const signIn = await fetch(`${observedApp.directUrl}/api/auth/sign-in/email`, {
      body: JSON.stringify({ email: observedApp.user.email, password: observedApp.user.password }),
      headers: {
        'content-type': 'application/json',
        origin: observedApp.url,
        'x-forwarded-for': '203.0.113.42',
        'x-request-id': 'obs-auth-1',
      },
      method: 'POST',
    })
    expect(signIn.status).toBe(200)

    const client = new Client({ connectionString: databaseUrl })
    await client.connect()
    const query = await client.query<{
      action: string
      actor_id: string | null
      ip_hash: string | null
      metadata: AuditMetadata
      outcome: string
      request_id: string | null
    }>('select action, actor_id, ip_hash, metadata, outcome, request_id from audit_log where request_id = $1', [
      'obs-auth-1',
    ])
    await client.end()

    expect(query.rows).toHaveLength(1)
    const row = query.rows[0]!
    expect(row).toMatchObject({
      action: 'auth.sign-in.email',
      metadata: { method: 'POST', path: '/sign-in/email', statusCode: 200 },
      outcome: 'success',
      request_id: 'obs-auth-1',
    })
    expect(row.actor_id).toBeTruthy()
    expect(row.ip_hash).toMatch(/^[0-9a-f]{32}$/)
    expect(JSON.stringify(row)).not.toContain('203.0.113.42')
    expect(JSON.stringify(row)).not.toContain(observedApp.user.email)

    const metrics = await fetch(`${observedApp.directUrl}/metrics`, {
      headers: { authorization: `Bearer ${METRICS_TOKEN}` },
    })
    expect(await metrics.text()).toContain('auth_events_total{event="auth.sign-in.email",outcome="success"} 1')
  })
})
