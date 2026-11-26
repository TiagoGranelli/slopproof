import '@tanstack/react-start/server-only'
import { AsyncLocalStorage } from 'node:async_hooks'
import { randomBytes, randomUUID } from 'node:crypto'

export interface ParsedTraceparent {
  readonly flags: string
  readonly parentSpanId: string
  readonly traceId: string
  readonly version: '00'
}

export interface RequestContext {
  readonly parentSpanId?: string
  readonly requestId: string
  readonly spanId: string
  readonly traceFlags: string
  readonly traceId: string
  readonly traceparent: string
}

const TRACEPARENT_PATTERN = /^(00)-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/
const ALL_ZERO_TRACE = '00000000000000000000000000000000'
const ALL_ZERO_SPAN = '0000000000000000'
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._-]{1,128}$/
const DEFAULT_TRACE_FLAGS = '01'

const STORAGE = Symbol.for('app.requestContext')
// Only this module writes this symbol-keyed store across server bundles.
// oxlint-disable-next-line typescript/no-unsafe-type-assertion
const shared = globalThis as { [STORAGE]?: AsyncLocalStorage<RequestContext> }
const storage = (shared[STORAGE] ??= new AsyncLocalStorage<RequestContext>())

export const buildTraceparent = (traceId: string, spanId: string, flags: string = DEFAULT_TRACE_FLAGS): string =>
  `00-${traceId}-${spanId}-${flags}`

export const parseTraceparent = (header: string | null | undefined): ParsedTraceparent | undefined => {
  const normalized = header?.trim().toLowerCase()
  if (!normalized || !TRACEPARENT_PATTERN.test(normalized)) {
    return undefined
  }
  const traceId = normalized.slice(3, 35)
  const parentSpanId = normalized.slice(36, 52)
  const flags = normalized.slice(53, 55)
  if (traceId === ALL_ZERO_TRACE || parentSpanId === ALL_ZERO_SPAN) {
    return undefined
  }
  return { flags, parentSpanId, traceId, version: '00' }
}

export const sanitizeRequestId = (header: string | null | undefined): string | undefined => {
  const candidate = header?.trim()
  if (!candidate || !REQUEST_ID_PATTERN.test(candidate)) {
    return undefined
  }
  return candidate
}

const generateTraceId = (): string => randomBytes(16).toString('hex')
const generateSpanId = (): string => randomBytes(8).toString('hex')

export const createRequestContext = (headers?: Headers): RequestContext => {
  const parsed = parseTraceparent(headers?.get('traceparent'))
  const traceId = parsed?.traceId ?? generateTraceId()
  const spanId = generateSpanId()
  const traceFlags = parsed?.flags ?? DEFAULT_TRACE_FLAGS
  const requestId = sanitizeRequestId(headers?.get('x-request-id')) ?? randomUUID()
  const traceparent = buildTraceparent(traceId, spanId, traceFlags)
  if (parsed) {
    return { parentSpanId: parsed.parentSpanId, requestId, spanId, traceFlags, traceId, traceparent }
  }
  return { requestId, spanId, traceFlags, traceId, traceparent }
}

const isRequestContext = (input: Headers | RequestContext | undefined): input is RequestContext =>
  input !== undefined && 'traceparent' in input

export const runWithRequestContext = <T>(input: Headers | RequestContext | undefined, callback: () => T): T => {
  const context = isRequestContext(input) ? input : createRequestContext(input)
  return storage.run(context, callback)
}

export const currentRequestContext = (): RequestContext | undefined => storage.getStore()
