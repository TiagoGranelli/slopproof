import { Effect, Exit, Option, Tracer } from 'effect'
import * as fc from 'fast-check'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createOtlpExporter,
  metricsLayer,
  normalizeRouteLabel,
  recordAuthEvent,
  recordHttpRequest,
  renderPrometheusMetrics,
  resetMetrics,
  resolveOtlpEndpoint,
} from '#/server/observability/telemetry.ts'
import type {
  AuthEventOutcome,
  HttpRequestMetric,
  OtlpAttribute,
  OtlpExporterOptions,
  OtlpSpanRecord,
  TelemetryExporter,
} from '#/server/observability/telemetry.ts'
import { runWithRequestContext } from '#/server/request-context.ts'
import { captureLog } from './process-fakes.ts'

const sampleSpan = (name: string): OtlpSpanRecord => ({
  attributes: [{ key: 'test', value: { stringValue: 'yes' } }] satisfies ReadonlyArray<OtlpAttribute>,
  endTimeUnixNano: '2000',
  kind: 1,
  name,
  spanId: '1111111111111111',
  startTimeUnixNano: '1000',
  status: { code: 1 },
  traceId: '11111111111111111111111111111111',
})

describe('Prometheus metrics and route normalization', () => {
  beforeEach(() => {
    resetMetrics()
  })

  it('normalizes UUIDs, numeric ids, query strings, and empty routes', () => {
    expect(normalizeRouteLabel('/api/posts/0195b8f4-4c68-7a10-9c2d-abcdef123456?cursor=1')).toBe('/api/posts/:id')
    expect(normalizeRouteLabel('/users/42/posts/99')).toBe('/users/:id/posts/:id')
    expect(normalizeRouteLabel('')).toBe('/')
  })

  it('never leaks query strings in normalized route labels', () => {
    fc.assert(
      fc.property(fc.string(), (raw) => {
        const normalized = normalizeRouteLabel(raw)
        expect(normalized.length).toBeGreaterThan(0)
        expect(normalized.includes('?')).toBe(false)
      }),
    )
  })

  it('records HTTP requests, durations, error counters, and auth events in Prometheus format', () => {
    const okMetric: HttpRequestMetric = { durationMs: 42, method: 'get', route: '/api/posts/123', status: 200 }
    const errMetric: HttpRequestMetric = { durationMs: -5, method: 'post', route: '/api/posts', status: 500 }
    const outcome: AuthEventOutcome = 'denied'
    recordHttpRequest(okMetric)
    recordHttpRequest(errMetric)
    recordAuthEvent('sign_in', outcome)
    const rendered = renderPrometheusMetrics()
    expect(rendered).toContain('http_requests_total{method="GET",route="/api/posts/:id",status="200"} 1')
    expect(rendered).toContain('http_errors_total{method="POST",route="/api/posts",status="500"} 1')
    expect(rendered).toContain('http_request_duration_ms_count{method="GET",route="/api/posts/:id"} 1')
    expect(rendered).toContain('auth_events_total{event="sign_in",outcome="denied"} 1')
  })
})

describe('resolveOtlpEndpoint', () => {
  it('accepts http/https URLs without trailing slashes and rejects invalid or non-http values', () => {
    expect(resolveOtlpEndpoint('http://localhost:4318///')).toBe('http://localhost:4318')
    expect(resolveOtlpEndpoint('https://otel.example.com/collector/')).toBe('https://otel.example.com/collector')
    expect(resolveOtlpEndpoint(undefined)).toBeUndefined()
    expect(resolveOtlpEndpoint('   ')).toBeUndefined()
    expect(resolveOtlpEndpoint('not a url')).toBeUndefined()
    expect(resolveOtlpEndpoint('file:///etc/passwd')).toBeUndefined()
  })
})

describe('createOtlpExporter disabled mode', () => {
  it('is a zero-overhead no-op when endpoint is unset', async () => {
    const exporter: TelemetryExporter = createOtlpExporter()
    expect(exporter.isEnabled()).toBe(false)
    exporter.enqueueSpan(sampleSpan('ignored'))
    expect(exporter.bufferedCount()).toBe(0)
    expect(await exporter.flush()).toBe(true)
    expect(exporter.tracerLayer).toBe(metricsLayer)
  })
})

const readPostedBody = (mockFetch: ReturnType<typeof vi.fn<typeof fetch>>): string => {
  const raw = mockFetch.mock.calls[0]?.[1]?.body
  return typeof raw === 'string' ? raw : ''
}

describe('createOtlpExporter enabled mode', () => {
  it('captures Effect spans with attributes, parent request context, and failure status', async () => {
    const mockFetch = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 200 }))
    const options: OtlpExporterOptions = { batchSize: 10, endpoint: 'http://otel.test', fetchImpl: mockFetch }
    const exporter = createOtlpExporter(options)
    const headers = new Headers({ traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01' })
    const program = Effect.withSpan('outer', {
      attributes: { flag: true, retries: 2, route: '/api/posts' },
      kind: 'server',
    })(Effect.withSpan('inner', { kind: 'client' })(Effect.fail('boom')))
    await runWithRequestContext(headers, () =>
      Effect.runPromiseExit(program.pipe(Effect.provide(exporter.tracerLayer))),
    )
    expect(exporter.bufferedCount()).toBe(2)
    expect(await exporter.flush()).toBe(true)
    expect(mockFetch).toHaveBeenCalledOnce()
    const payload = JSON.parse(readPostedBody(mockFetch)) as {
      resourceSpans: Array<{ scopeSpans: Array<{ spans: Array<OtlpSpanRecord> }> }>
    }
    const spans = payload.resourceSpans[0]?.scopeSpans[0]?.spans ?? []
    expect(spans).toHaveLength(2)
    expect(spans[1]?.traceId).toBe('4bf92f3577b34da6a3ce929d0e0e4736')
    expect(spans[0]?.status.code).toBe(2)
  })

  it('ignores unsampled and duplicate-ended spans and handles missing request context', async () => {
    const mockFetch = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 200 }))
    const exporter = createOtlpExporter({ batchSize: 10, endpoint: 'http://otel.test', fetchImpl: mockFetch })
    const spanProgram = Effect.gen(function* () {
      const tracer = yield* Tracer.Tracer
      const annotations = yield* Effect.context()
      const sampled = tracer.span({
        annotations,
        kind: 'internal',
        links: [],
        name: 'once',
        parent: Option.none(),
        root: true,
        sampled: true,
        startTime: 1n,
      })
      sampled.end(2n, Exit.void)
      sampled.end(3n, Exit.void)
      const unsampled = tracer.span({
        annotations,
        kind: 'producer',
        links: [],
        name: 'skip',
        parent: Option.none(),
        root: true,
        sampled: false,
        startTime: 1n,
      })
      unsampled.end(2n, Exit.void)
    })
    await Effect.runPromise(spanProgram.pipe(Effect.provide(exporter.tracerLayer)))
    expect(exporter.bufferedCount()).toBe(1)
    expect(await exporter.flush()).toBe(true)
    expect(await exporter.flush()).toBe(true)
  })

  it('drops oldest spans when ring buffer is full and auto-flushes at batchSize', async () => {
    const mockFetch = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 200 }))
    const bounded = createOtlpExporter({
      batchSize: 5,
      endpoint: 'http://otel.test',
      fetchImpl: mockFetch,
      headers: { 'x-otel-key': 'k' },
      maxBufferSize: 2,
      serviceName: 'custom-svc',
    })
    bounded.enqueueSpan(sampleSpan('first'))
    bounded.enqueueSpan(sampleSpan('second'))
    bounded.enqueueSpan(sampleSpan('third'))
    expect(bounded.bufferedCount()).toBe(2)
    expect(await bounded.flush()).toBe(true)
    expect(readPostedBody(mockFetch)).not.toContain('first')
    expect(readPostedBody(mockFetch)).toContain('third')
  })

  it('auto-flushes at batchSize and supports default exporter options', async () => {
    const mockFetch = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 200 }))
    const autoFlush = createOtlpExporter({ batchSize: 2, endpoint: 'http://otel.test', fetchImpl: mockFetch })
    const defaultsOnly = createOtlpExporter({ endpoint: 'http://otel.test' })
    expect(defaultsOnly.isEnabled()).toBe(true)
    autoFlush.enqueueSpan(sampleSpan('a'))
    autoFlush.enqueueSpan(sampleSpan('b'))
    await Promise.resolve()
    expect(mockFetch).toHaveBeenCalledOnce()
    expect(autoFlush.bufferedCount()).toBe(0)
  })

  it('logs warnings and returns false on HTTP rejection or network failure', async () => {
    const lines = captureLog()
    const rejectedFetch = vi.fn<typeof fetch>().mockResolvedValue(new Response('bad', { status: 503 }))
    const failingFetch = vi.fn<typeof fetch>().mockRejectedValue(new Error('network down'))
    const rejected = createOtlpExporter({ batchSize: 5, endpoint: 'http://otel.test', fetchImpl: rejectedFetch })
    const failed = createOtlpExporter({ batchSize: 5, endpoint: 'http://otel.test', fetchImpl: failingFetch })
    rejected.enqueueSpan(sampleSpan('r1'))
    failed.enqueueSpan(sampleSpan('f1'))
    expect(await rejected.flush()).toBe(false)
    expect(await failed.flush()).toBe(false)
    expect(lines[0]).toMatchObject({ level: 'warn', msg: 'otlp export rejected', status: 503 })
    expect(lines[1]).toMatchObject({ level: 'warn', msg: 'otlp export failed' })
  })
})
