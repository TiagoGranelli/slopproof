import '@tanstack/react-start/server-only'
import { log } from '../log.ts'
import { currentRequestContext } from '../request-context.ts'

export interface CapturedErrorReport {
  readonly code?: number | string
  readonly message: string
  readonly name: string
  readonly requestId?: string
  readonly stack?: string
  readonly tags?: Readonly<Record<string, string>>
  readonly timestamp: string
  readonly traceId?: string
}

export interface ErrorReportContext {
  readonly requestId?: string
  readonly tags?: Readonly<Record<string, string>>
  readonly traceId?: string
}

export interface ErrorReporter {
  readonly capture: (report: CapturedErrorReport) => Promise<void> | void
}

interface DescribedError {
  readonly code?: number | string
  readonly message: string
  readonly name: string
  readonly stack?: string
}

interface MutableReport {
  code?: number | string
  message: string
  name: string
  requestId?: string
  stack?: string
  tags?: Readonly<Record<string, string>>
  timestamp: string
  traceId?: string
}

const REPORTER_KEY = Symbol.for('app.errorReporter')
// Only this module writes this symbol-keyed reporter across server bundles.
// oxlint-disable-next-line typescript/no-unsafe-type-assertion
const shared = globalThis as { [REPORTER_KEY]?: ErrorReporter | null }

const MAX_MESSAGE_LENGTH = 512
const MAX_TAG_VALUE_LENGTH = 128
const MAX_STACK_FRAMES = 12

const SENSITIVE_TAG_KEY =
  /^(?:authorization|cookie|email|passwd|password|secret|set-cookie|sql|token|api[-_]?key|params)$/i
const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi
const AUTH_TOKEN_PATTERN = /\b(?:bearer|basic)\s+[A-Za-z0-9._~+/=-]+/gi
const JWT_PATTERN = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g
const URL_CREDENTIAL_PATTERN = /\b([a-z][a-z\d+.-]*:\/\/)[^/\s@]+@/gi
const SECRET_PAIR_PATTERN =
  /\b(cookie|set-cookie|password|passwd|secret|token|api[_-]?key|authorization)\s*[:=]\s*[^\s,;]+/gi
const SQL_PARAMS_PATTERN = /\bparams\s*[:=]\s*\[[^\]]*\]/gi
const SQL_LITERAL_PATTERN = /'(?:[^'\\]|\\.){1,200}'/g

export const redactSensitiveText = (raw: string, maxLength: number = MAX_MESSAGE_LENGTH): string => {
  const newline = raw.indexOf('\n')
  const firstLine = newline === -1 ? raw : raw.slice(0, newline)
  const scrubbed = firstLine
    .replaceAll(URL_CREDENTIAL_PATTERN, '$1[redacted]@')
    .replaceAll(AUTH_TOKEN_PATTERN, '[redacted-token]')
    .replaceAll(JWT_PATTERN, '[redacted-jwt]')
    .replaceAll(EMAIL_PATTERN, '[redacted-email]')
    .replaceAll(SECRET_PAIR_PATTERN, '$1=[redacted]')
    .replaceAll(SQL_PARAMS_PATTERN, 'params=[redacted]')
    .replaceAll(SQL_LITERAL_PATTERN, "'[redacted]'")
  return scrubbed.length > maxLength ? scrubbed.slice(0, maxLength) : scrubbed
}

const extractStackFrames = (stack: string | undefined): string | undefined => {
  if (!stack) {
    return undefined
  }
  const lines = stack
    .split('\n')
    .filter((line) => line.trimStart().startsWith('at '))
    .slice(0, MAX_STACK_FRAMES)
  return lines.length > 0 ? lines.join('\n') : undefined
}

const extractErrorCode = (error: Error): number | string | undefined => {
  const code = 'code' in error ? error.code : undefined
  return typeof code === 'string' || typeof code === 'number' ? code : undefined
}

const sanitizeTags = (
  tags: Readonly<Record<string, string>> | undefined,
): Readonly<Record<string, string>> | undefined => {
  if (!tags) {
    return undefined
  }
  const cleaned: Record<string, string> = {}
  let count = 0
  for (const [key, value] of Object.entries(tags)) {
    if (SENSITIVE_TAG_KEY.test(key)) {
      continue
    }
    cleaned[key] = redactSensitiveText(value, MAX_TAG_VALUE_LENGTH)
    count += 1
  }
  return count > 0 ? cleaned : undefined
}

const describeUnknownError = (error: unknown): DescribedError => {
  if (error instanceof Error) {
    return {
      code: extractErrorCode(error),
      message: redactSensitiveText(error.message),
      name: error.name || 'Error',
      stack: extractStackFrames(error.stack),
    }
  }
  if (typeof error === 'string') {
    return { message: redactSensitiveText(error), name: 'StringError' }
  }
  return { message: 'Non-Error exception captured', name: 'UnknownError' }
}

const attachContextFields = (report: MutableReport, context?: ErrorReportContext): void => {
  const active = currentRequestContext()
  const requestId = context?.requestId ?? active?.requestId
  const traceId = context?.traceId ?? active?.traceId
  const tags = sanitizeTags(context?.tags)
  if (requestId) {
    report.requestId = requestId
  }
  if (traceId) {
    report.traceId = traceId
  }
  if (tags) {
    report.tags = tags
  }
}

export const summarizeCapturedError = (error: unknown, context?: ErrorReportContext): CapturedErrorReport => {
  const details = describeUnknownError(error)
  const report: MutableReport = {
    message: details.message,
    name: details.name,
    timestamp: new Date().toISOString(),
  }
  if (details.code !== undefined) {
    report.code = details.code
  }
  if (details.stack) {
    report.stack = details.stack
  }
  attachContextFields(report, context)
  return report
}

export const registerErrorReporter = (reporter: ErrorReporter | null): void => {
  shared[REPORTER_KEY] = reporter
}

export const currentErrorReporter = (): ErrorReporter | null => shared[REPORTER_KEY] ?? null

const dispatchReport = async (reporter: ErrorReporter, report: CapturedErrorReport): Promise<void> => {
  try {
    await reporter.capture(report)
  } catch (error) {
    log('warn', 'error reporter failed', { error })
  }
}

export const reportCapturedError = (error: unknown, context?: ErrorReportContext): void => {
  const reporter = shared[REPORTER_KEY]
  if (!reporter) {
    return
  }
  void dispatchReport(reporter, summarizeCapturedError(error, context))
}
