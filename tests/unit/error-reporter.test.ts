import * as fc from 'fast-check'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  currentErrorReporter,
  redactSensitiveText,
  registerErrorReporter,
  reportCapturedError,
  summarizeCapturedError,
} from '#/server/observability/error-reporter.ts'
import type { CapturedErrorReport, ErrorReportContext, ErrorReporter } from '#/server/observability/error-reporter.ts'
import { runWithRequestContext } from '#/server/request-context.ts'
import { captureLog } from './process-fakes.ts'

describe('redactSensitiveText', () => {
  it('scrubs emails, tokens, JWTs, URL credentials, cookies, and SQL params', () => {
    const raw =
      "Auth failed for alice@example.com Bearer secret.tok-123 eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig postgres://admin:not-a-secret@db/app cookie=abc123 params=[1,'secret']\nsecond line"
    const clean = redactSensitiveText(raw)
    expect(clean).not.toContain('alice@example.com')
    expect(clean).not.toContain('secret.tok-123')
    expect(clean).not.toContain('eyJhbGciOiJIUzI1NiJ9')
    expect(clean).not.toContain('admin:not-a-secret')
    expect(clean).not.toContain('abc123')
    expect(clean).not.toContain('second line')
    expect(clean).toContain('[redacted-email]')
    expect(clean).toContain('[redacted-token]')
    expect(clean).toContain('[redacted-jwt]')
    expect(clean).toContain('params=[redacted]')
  })

  it('truncates long messages and never includes newlines for arbitrary input', () => {
    expect(redactSensitiveText('x'.repeat(600))).toHaveLength(512)
    fc.assert(
      fc.property(fc.string(), (raw) => {
        const clean = redactSensitiveText(raw, 64)
        expect(clean.length).toBeLessThanOrEqual(64)
        expect(clean.includes('\n')).toBe(false)
      }),
    )
  })
})

describe('summarizeCapturedError', () => {
  it('summarizes Error objects with code, frames, active request context, and safe tags', () => {
    const err = Object.assign(new Error('DB failed for user@example.com'), { code: 'ECONNRESET' })
    const headers = new Headers({
      traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
      'x-request-id': 'req-err-1',
    })
    const context: ErrorReportContext = {
      tags: { authorization: 'Bearer abc', email: 'a@b.com', route: '/api/posts' },
    }
    const report: CapturedErrorReport = runWithRequestContext(headers, () => summarizeCapturedError(err, context))
    expect(report.code).toBe('ECONNRESET')
    expect(report.name).toBe('Error')
    expect(report.message).toBe('DB failed for [redacted-email]')
    expect(report.requestId).toBe('req-err-1')
    expect(report.traceId).toBe('4bf92f3577b34da6a3ce929d0e0e4736')
    expect(report.tags).toEqual({ route: '/api/posts' })
    expect(report.stack).toContain('at ')
  })

  it('handles Error without name/stack, string errors, unknown values, and all-sensitive tags', () => {
    const nameless = Object.assign(new Error('plain'), { code: 42, name: '', stack: 'Error: plain' })
    const noStack = Object.assign(new Error('nostack'), { stack: undefined })
    expect(summarizeCapturedError(nameless, { tags: { password: '123' } })).toMatchObject({
      code: 42,
      message: 'plain',
      name: 'Error',
    })
    expect(summarizeCapturedError(noStack).stack).toBeUndefined()
    expect(summarizeCapturedError('boom bob@example.com')).toMatchObject({
      message: 'boom [redacted-email]',
      name: 'StringError',
    })
    expect(summarizeCapturedError({ secret: 'hidden' })).toMatchObject({
      message: 'Non-Error exception captured',
      name: 'UnknownError',
    })
  })
})

describe('registerErrorReporter and reportCapturedError', () => {
  afterEach(() => {
    registerErrorReporter(null)
  })

  it('is a no-op when no reporter is registered and invokes registered reporter when set', () => {
    expect(currentErrorReporter()).toBeNull()
    reportCapturedError(new Error('ignored'))
    const capture = vi.fn<(report: CapturedErrorReport) => void>()
    const reporter: ErrorReporter = { capture }
    registerErrorReporter(reporter)
    expect(currentErrorReporter()).toBe(reporter)
    reportCapturedError(new Error('captured'), { requestId: 'r-1', traceId: 't-1' })
    expect(capture).toHaveBeenCalledOnce()
    expect(capture.mock.calls[0]?.[0]).toMatchObject({ message: 'captured', requestId: 'r-1', traceId: 't-1' })
  })

  it('catches both sync throws and async rejections from reporters without crashing', async () => {
    const lines = captureLog()
    registerErrorReporter({
      capture: () => {
        throw new Error('sync reporter crash')
      },
    })
    reportCapturedError(new Error('first'))
    registerErrorReporter({
      capture: async () => {
        throw new Error('async reporter crash')
      },
    })
    reportCapturedError(new Error('second'))
    await Promise.resolve()
    await Promise.resolve()
    expect(lines).toHaveLength(2)
    expect(lines[0]).toMatchObject({ level: 'warn', msg: 'error reporter failed' })
    expect(lines[1]).toMatchObject({ level: 'warn', msg: 'error reporter failed' })
  })
})
