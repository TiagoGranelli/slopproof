import * as fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  buildTraceparent,
  createRequestContext,
  currentRequestContext,
  parseTraceparent,
  runWithRequestContext,
  sanitizeRequestId,
} from '#/server/request-context.ts'
import type { ParsedTraceparent, RequestContext } from '#/server/request-context.ts'

const HEX = /^[0-9a-f]+$/
const hexString = (length: number) => fc.stringMatching(new RegExp(`^[0-9a-f]{${length}}$`))

describe('parseTraceparent and buildTraceparent', () => {
  it('parses valid W3C traceparent headers and normalizes case', () => {
    const traceId = '4bf92f3577b34da6a3ce929d0e0e4736'
    const parentSpanId = '00f067aa0ba902b7'
    const parsed: ParsedTraceparent | undefined = parseTraceparent(`  00-${traceId.toUpperCase()}-${parentSpanId}-01 `)
    expect(parsed).toEqual({ flags: '01', parentSpanId, traceId, version: '00' })
    expect(buildTraceparent(traceId, parentSpanId)).toBe(`00-${traceId}-${parentSpanId}-01`)
    expect(buildTraceparent(traceId, parentSpanId, '00')).toBe(`00-${traceId}-${parentSpanId}-00`)
  })

  it('rejects missing, malformed, wrong-version, and all-zero traceparent headers', () => {
    expect(parseTraceparent(undefined)).toBeUndefined()
    expect(parseTraceparent(null)).toBeUndefined()
    expect(parseTraceparent('   ')).toBeUndefined()
    expect(parseTraceparent('not-a-traceparent')).toBeUndefined()
    expect(parseTraceparent('ff-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01')).toBeUndefined()
    expect(parseTraceparent('00-00000000000000000000000000000000-00f067aa0ba902b7-01')).toBeUndefined()
    expect(parseTraceparent('00-4bf92f3577b34da6a3ce929d0e0e4736-0000000000000000-01')).toBeUndefined()
  })

  it('round-trips arbitrary valid non-zero traceparent values', () => {
    fc.assert(
      fc.property(
        hexString(32).filter((value) => !/^0+$/.test(value)),
        hexString(16).filter((value) => !/^0+$/.test(value)),
        hexString(2),
        (traceId, parentSpanId, flags) => {
          const header = buildTraceparent(traceId, parentSpanId, flags)
          expect(parseTraceparent(header)).toEqual({ flags, parentSpanId, traceId, version: '00' })
        },
      ),
    )
  })
})

describe('sanitizeRequestId', () => {
  it('accepts safe identifiers and rejects empty, overlong, or unsafe values', () => {
    expect(sanitizeRequestId(' req_123.abc-9 ')).toBe('req_123.abc-9')
    expect(sanitizeRequestId(undefined)).toBeUndefined()
    expect(sanitizeRequestId(null)).toBeUndefined()
    expect(sanitizeRequestId('   ')).toBeUndefined()
    expect(sanitizeRequestId('bad\nid')).toBeUndefined()
    expect(sanitizeRequestId('has space')).toBeUndefined()
    expect(sanitizeRequestId('a'.repeat(129))).toBeUndefined()
  })

  it('never returns characters outside the safe charset for arbitrary input', () => {
    fc.assert(
      fc.property(fc.string(), (raw) => {
        const sanitized = sanitizeRequestId(raw)
        expect(sanitized === undefined || /^[A-Za-z0-9._-]{1,128}$/.test(sanitized)).toBe(true)
      }),
    )
  })
})

describe('createRequestContext and runWithRequestContext', () => {
  it('generates fresh cryptographic ids when headers are omitted', () => {
    const context = createRequestContext()
    expect(context.parentSpanId).toBeUndefined()
    expect(context.traceId).toMatch(HEX)
    expect(context.traceId).toHaveLength(32)
    expect(context.spanId).toMatch(HEX)
    expect(context.spanId).toHaveLength(16)
    expect(context.traceparent).toBe(buildTraceparent(context.traceId, context.spanId, '01'))
    expect(context.requestId.length).toBeGreaterThan(0)
  })

  it('propagates incoming traceparent and x-request-id while minting a new server spanId', () => {
    const traceId = '4bf92f3577b34da6a3ce929d0e0e4736'
    const parentSpanId = '00f067aa0ba902b7'
    const headers = new Headers({
      traceparent: `00-${traceId}-${parentSpanId}-00`,
      'x-request-id': 'edge-req-42',
    })
    const context = createRequestContext(headers)
    expect(context.traceId).toBe(traceId)
    expect(context.parentSpanId).toBe(parentSpanId)
    expect(context.spanId).not.toBe(parentSpanId)
    expect(context.requestId).toBe('edge-req-42')
    expect(context.traceFlags).toBe('00')
    expect(context.traceparent).toBe(`00-${traceId}-${context.spanId}-00`)
  })

  it('isolates context across async boundaries and supports explicit RequestContext', async () => {
    expect(currentRequestContext()).toBeUndefined()
    const explicit: RequestContext = createRequestContext(new Headers({ 'x-request-id': 'explicit-1' }))
    const observed = await runWithRequestContext(explicit, async () => {
      await Promise.resolve()
      return currentRequestContext()
    })
    expect(observed).toEqual(explicit)
    expect(currentRequestContext()).toBeUndefined()
  })

  it('accepts Headers or undefined directly in runWithRequestContext', () => {
    const fromHeaders = runWithRequestContext(new Headers({ 'x-request-id': 'hdr-1' }), () => currentRequestContext())
    const fromUndefined = runWithRequestContext(undefined, () => currentRequestContext())
    expect(fromHeaders?.requestId).toBe('hdr-1')
    expect(fromUndefined?.traceId).toHaveLength(32)
  })
})
