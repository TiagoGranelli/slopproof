import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '#/contract/limits.ts'
import { AuthActionError } from '#/features/auth/api/auth-action.ts'
import type { AuthFailureCode } from '#/lib/auth.functions.ts'

const GENERIC = 'Something went wrong. Try again.'
const EXPIRED_LINK = 'This link is invalid or has expired. Ask for a new one.'
const SESSION_ENDED = 'Your session has ended. Sign in again to continue.'

const MESSAGES: Record<Exclude<AuthFailureCode, 'RATE_LIMITED'>, string> = {
  CREDENTIAL_ACCOUNT_NOT_FOUND: GENERIC,
  CROSS_SITE_NAVIGATION_LOGIN_BLOCKED: GENERIC,
  EMAIL_ALREADY_VERIFIED: 'This email address is already confirmed.',
  EMAIL_MISMATCH: GENERIC,
  EMAIL_NOT_VERIFIED: 'Confirm your email address first. We have sent you a new link.',
  FAILED_TO_CREATE_SESSION: GENERIC,
  FAILED_TO_CREATE_USER: GENERIC,
  FAILED_TO_GET_SESSION: GENERIC,
  INVALID_EMAIL: 'Enter a valid email address.',
  INVALID_EMAIL_OR_PASSWORD: 'Wrong email or password.',
  INVALID_ORIGIN: GENERIC,
  INVALID_PASSWORD: 'That password is not correct.',
  INVALID_TOKEN: EXPIRED_LINK,
  INVALID_USER: EXPIRED_LINK,
  MISSING_OR_NULL_ORIGIN: GENERIC,
  NOT_FOUND: GENERIC,
  PASSWORD_TOO_LONG: `Use at most ${PASSWORD_MAX_LENGTH} characters.`,
  PASSWORD_TOO_SHORT: `Use at least ${PASSWORD_MIN_LENGTH} characters.`,
  SESSION_EXPIRED: SESSION_ENDED,
  SESSION_NOT_FRESH: 'For your security, sign in again to see your sessions.',
  TOKEN_EXPIRED: EXPIRED_LINK,
  UNAUTHORIZED: SESSION_ENDED,
  UNEXPECTED: GENERIC,
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: GENERIC,
  USER_NOT_FOUND: EXPIRED_LINK,
  VALIDATION_ERROR: GENERIC,
}

export const isAuthFailureCode = (value: string): value is AuthFailureCode =>
  value === 'RATE_LIMITED' || Object.hasOwn(MESSAGES, value)

export interface AuthFailureSearch {
  error?: AuthFailureCode
  retryAfter?: number
}

export function failureFromSearch(search: {
  readonly error?: unknown
  readonly retryAfter?: unknown
}): AuthFailureSearch {
  const { error, retryAfter } = search
  if (typeof error !== 'string' || !isAuthFailureCode(error)) {
    return {}
  }
  const wait = typeof retryAfter === 'number' && Number.isInteger(retryAfter) && retryAfter > 0
  return wait ? { error, retryAfter } : { error }
}

const retryIn = (seconds: number | undefined) =>
  seconds !== undefined && seconds > 0
    ? `Too many attempts. Try again in ${seconds} second${seconds === 1 ? '' : 's'}.`
    : 'Too many attempts. Try again in a moment.'

export function describeAuthFailure(error: unknown): string {
  if (!(error instanceof AuthActionError)) {
    return 'Could not reach the server. Check your connection and try again.'
  }
  if (error.code === 'RATE_LIMITED') {
    return retryIn(error.retryAfter)
  }
  return Object.hasOwn(MESSAGES, error.code) ? MESSAGES[error.code] : GENERIC
}

export type AuthFieldCodes = Partial<Record<AuthFailureCode, string>>

export function authFieldIssues(error: unknown, fields: AuthFieldCodes): Record<string, string> {
  if (!(error instanceof AuthActionError)) {
    return {}
  }
  const field = fields[error.code]
  return field === undefined ? {} : { [field]: describeAuthFailure(error) }
}
