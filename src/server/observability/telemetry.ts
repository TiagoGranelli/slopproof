import '@tanstack/react-start/server-only'
import { Context, Exit, Layer, Metric, Option, Tracer } from 'effect'
import { PrometheusMetrics } from 'effect/observability'
import { log } from '../log.ts'
import { currentRequestContext } from '../request-context.ts'

export type AuthEventOutcome = 'denied' | 'failure' | 'success'

export interface HttpRequestMetric {
  readonly durationMs: number
  readonly method: string
  readonly route: string
  readonly status: number
}

export interface OtlpAttribute {
  readonly key: string
  readonly value: { readonly boolValue?: boolean; readonly doubleValue?: number; readonly stringValue?: string }
}

export interface OtlpSpanRecord {
  readonly attributes: ReadonlyArray<OtlpAttribute>
  readonly endTimeUnixNano: string
  readonly kind: number
  readonly name: string
  readonly parentSpanId?: string
  readonly spanId: string
  readonly startTimeUnixNano: string
  readonly status: { readonly code: 1 | 2 }
  readonly traceId: string
}

export interface OtlpExporterOptions {
  readonly batchSize?: number
  readonly endpoint?: string
  readonly fetchImpl?: typeof fetch
  readonly headers?: Readonly<Record<string, string>>
  readonly maxBufferSize?: number
  readonly serviceName?: string
}

export interface TelemetryExporter {
  readonly bufferedCount: () => number
  readonly enqueueSpan: (span: OtlpSpanRecord) => void
  readonly flush: () => Promise<boolean>
  readonly isEnabled: () => boolean
  readonly tracerLayer: Layer.Layer<never>
}

interface OtlpBatchTarget {
  readonly endpoint: string
  readonly fetchImpl: typeof fetch
  readonly headers: Readonly<Record<string, string>>
  readonly serviceName: string
}

const REGISTRY_KEY = Symbol.for('app.metricsRegistry')
// Only this module writes this symbol-keyed registry across server bundles.
// oxlint-disable-next-line typescript/no-unsafe-type-assertion
const shared = globalThis as { [REGISTRY_KEY]?: Metric.MetricRegistry }
const registry: Metric.MetricRegistry = (shared[REGISTRY_KEY] ??= new Map())
const metricContext = Context.make(Metric.MetricRegistry, registry)

const DURATION_BUCKETS = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000] as const
const DEFAULT_BATCH_SIZE = 32
const DEFAULT_MAX_BUFFER = 256
const DEFAULT_SERVICE_NAME = 'app'
const UUID_SEGMENT = /\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?=\/|$)/gi
const NUMERIC_SEGMENT = /\/\d+(?=\/|$)/g

const httpRequestsTotal = Metric.counter('http_requests_total', {
  description: 'Total HTTP requests processed',
  incremental: true,
})

const httpRequestDurationMs = Metric.histogram('http_request_duration_ms', {
  boundaries: DURATION_BUCKETS,
  description: 'HTTP request duration in milliseconds',
})

const httpErrorsTotal = Metric.counter('http_errors_total', {
  description: 'Total HTTP error responses',
  incremental: true,
})

const authEventsTotal = Metric.counter('auth_events_total', {
  description: 'Total authentication events',
  incremental: true,
})

export const normalizeRouteLabel = (rawRoute: string): string => {
  const queryIndex = rawRoute.indexOf('?')
  const pathOnly = queryIndex === -1 ? rawRoute : rawRoute.slice(0, queryIndex)
  const cleaned = pathOnly.replaceAll(UUID_SEGMENT, '/:id').replaceAll(NUMERIC_SEGMENT, '/:id')
  return cleaned.length > 0 ? cleaned : '/'
}

export const recordHttpRequest = (metric: HttpRequestMetric): void => {
  const method = metric.method.toUpperCase()
  const route = normalizeRouteLabel(metric.route)
  const status = String(metric.status)
  Metric.withAttributes(httpRequestsTotal, { method, route, status }).updateUnsafe(1, metricContext)
  Metric.withAttributes(httpRequestDurationMs, { method, route }).updateUnsafe(
    Math.max(0, metric.durationMs),
    metricContext,
  )
  if (metric.status >= 400) {
    Metric.withAttributes(httpErrorsTotal, { method, route, status }).updateUnsafe(1, metricContext)
  }
}

export const recordAuthEvent = (event: string, outcome: AuthEventOutcome): void => {
  Metric.withAttributes(authEventsTotal, { event, outcome }).updateUnsafe(1, metricContext)
}

export const renderPrometheusMetrics = (): string => PrometheusMetrics.formatUnsafe(metricContext)

export const resetMetrics = (): void => {
  registry.clear()
}

export const resolveOtlpEndpoint = (raw: string | undefined): string | undefined => {
  const trimmed = raw?.trim()
  if (!trimmed) {
    return undefined
  }
  const parsed = URL.parse(trimmed)
  if (!parsed || (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')) {
    return undefined
  }
  return trimmed.replace(/\/+$/, '')
}

const toOtlpAttribute = (key: string, value: unknown): OtlpAttribute => {
  if (typeof value === 'boolean') {
    return { key, value: { boolValue: value } }
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return { key, value: { doubleValue: value } }
  }
  return { key, value: { stringValue: String(value) } }
}

const spanKindCode = (kind: Tracer.SpanKind): number => {
  const table: Record<Tracer.SpanKind, number> = {
    client: 3,
    consumer: 5,
    internal: 1,
    producer: 4,
    server: 2,
  }
  return table[kind]
}

const toOtlpSpanRecord = (
  span: Tracer.NativeSpan,
  endTime: bigint,
  exit: Exit.Exit<unknown, unknown>,
): OtlpSpanRecord => {
  const parent = Option.getOrUndefined(span.parent)
  const attributes = Array.from(span.attributes.entries(), ([key, value]) => toOtlpAttribute(key, value))
  const record: OtlpSpanRecord = {
    attributes,
    endTimeUnixNano: String(endTime),
    kind: spanKindCode(span.kind),
    name: span.name,
    spanId: span.spanId,
    startTimeUnixNano: String(span.startTime),
    status: { code: Exit.isSuccess(exit) ? 1 : 2 },
    traceId: span.traceId,
  }
  return parent ? { ...record, parentSpanId: parent.spanId } : record
}

type SpanOptions = Parameters<Tracer.Tracer['span']>[0]

class ExportingSpan extends Tracer.NativeSpan {
  readonly #onEnd: (record: OtlpSpanRecord) => void

  constructor(options: SpanOptions, onEnd: (record: OtlpSpanRecord) => void) {
    super(options)
    this.#onEnd = onEnd
  }

  override end(endTime: bigint, exit: Exit.Exit<unknown, unknown>): void {
    const alreadyEnded = this.status._tag === 'Ended'
    super.end(endTime, exit)
    if (!alreadyEnded && this.sampled) {
      this.#onEnd(toOtlpSpanRecord(this, endTime, exit))
    }
  }
}

const attachRequestParent = (options: SpanOptions): SpanOptions => {
  if (Option.isSome(options.parent)) {
    return options
  }
  const request = currentRequestContext()
  if (!request) {
    return options
  }
  const external = Tracer.externalSpan({ spanId: request.spanId, traceId: request.traceId })
  return { ...options, parent: Option.some(external) }
}

const buildOtlpTraceBody = (serviceName: string, spans: ReadonlyArray<OtlpSpanRecord>): string =>
  JSON.stringify({
    resourceSpans: [
      {
        resource: { attributes: [{ key: 'service.name', value: { stringValue: serviceName } }] },
        scopeSpans: [{ scope: { name: 'app.telemetry' }, spans }],
      },
    ],
  })

const postOtlpBatch = async (target: OtlpBatchTarget, spans: ReadonlyArray<OtlpSpanRecord>): Promise<boolean> => {
  try {
    const response = await target.fetchImpl(`${target.endpoint}/v1/traces`, {
      body: buildOtlpTraceBody(target.serviceName, spans),
      headers: { ...target.headers, 'content-type': 'application/json' },
      method: 'POST',
    })
    if (!response.ok) {
      log('warn', 'otlp export rejected', { count: spans.length, status: response.status })
      return false
    }
    return true
  } catch (error) {
    log('warn', 'otlp export failed', { count: spans.length, error })
    return false
  }
}

export const metricsLayer: Layer.Layer<never> = Layer.succeed(Metric.MetricRegistry, registry)

const createExportingLayer = (enqueueSpan: (span: OtlpSpanRecord) => void): Layer.Layer<never> => {
  const tracer = Tracer.make({
    span: (spanOptions) => new ExportingSpan(attachRequestParent(spanOptions), enqueueSpan),
  })
  return Layer.mergeAll(metricsLayer, Layer.succeed(Tracer.Tracer, tracer))
}

const createDisabledExporter = (): TelemetryExporter => ({
  bufferedCount: () => 0,
  enqueueSpan: () => {},
  flush: async () => true,
  isEnabled: () => false,
  tracerLayer: metricsLayer,
})

const pushBounded = (buffer: Array<OtlpSpanRecord>, span: OtlpSpanRecord, maxBufferSize: number): void => {
  if (buffer.length >= maxBufferSize) {
    buffer.shift()
  }
  buffer.push(span)
}

interface OtlpExporterConfig extends OtlpBatchTarget {
  readonly batchSize: number
  readonly maxBufferSize: number
}

const createEnabledExporter = (config: OtlpExporterConfig): TelemetryExporter => {
  const buffer: Array<OtlpSpanRecord> = []
  const flush = async (): Promise<boolean> => (buffer.length === 0 ? true : postOtlpBatch(config, buffer.splice(0)))
  const enqueueSpan = (span: OtlpSpanRecord): void => {
    pushBounded(buffer, span, config.maxBufferSize)
    if (buffer.length >= config.batchSize) {
      void flush()
    }
  }
  return {
    bufferedCount: () => buffer.length,
    enqueueSpan,
    flush,
    isEnabled: () => true,
    tracerLayer: createExportingLayer(enqueueSpan),
  }
}

export const createOtlpExporter = (options: OtlpExporterOptions = {}): TelemetryExporter => {
  const endpoint = resolveOtlpEndpoint(options.endpoint)
  if (!endpoint) {
    return createDisabledExporter()
  }
  const batchSize = Math.max(1, options.batchSize ?? DEFAULT_BATCH_SIZE)
  const maxBufferSize = Math.max(1, options.maxBufferSize ?? DEFAULT_MAX_BUFFER)
  return createEnabledExporter({
    batchSize,
    endpoint,
    fetchImpl: options.fetchImpl ?? fetch,
    headers: options.headers ?? {},
    maxBufferSize,
    serviceName: options.serviceName ?? DEFAULT_SERVICE_NAME,
  })
}
