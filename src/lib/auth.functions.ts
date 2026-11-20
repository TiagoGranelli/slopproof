import { redirect } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { setResponseHeader } from '@tanstack/react-start/server'
import { Schema } from 'effect'
import {
  ChangePasswordInput,
  DeleteAccountInput,
  EmailInput,
  ResetPasswordInput,
  SessionInput,
  SignInFormPost,
  SignInInput,
  SignUpInput,
  TokenInput,
} from '#/lib/account-input.ts'
import { env } from '#/server/env.ts'
import { type AuthEndpointResult, type AuthErrorCode, callAuthEndpoint } from '#/server/http/auth-handler.ts'
import { displayClientAddress } from '#/server/http/client-address.ts'

export type AuthFailureCode = AuthErrorCode | 'RATE_LIMITED' | 'NOT_FOUND' | 'UNEXPECTED'

export interface AuthFailure {
  readonly code: AuthFailureCode
  readonly retryAfter?: number
}

export type AuthOutcome<T = null> =
  | { readonly ok: true; readonly value: T }
  | { readonly failure: AuthFailure; readonly ok: false }

type EndpointFailure = Extract<AuthEndpointResult, { ok: false }>

const failureCode = (refused: EndpointFailure): AuthFailureCode => {
  if (refused.status === 429) {
    return 'RATE_LIMITED'
  }
  if (refused.code !== undefined) {
    return refused.code
  }
  return refused.status === 404 ? 'NOT_FOUND' : 'UNEXPECTED'
}

const failure = (refused: EndpointFailure): AuthOutcome<never> => {
  const code = failureCode(refused)
  const { retryAfter } = refused
  return { failure: retryAfter === undefined ? { code } : { code, retryAfter }, ok: false }
}

const done = (answer: AuthEndpointResult): AuthOutcome => (answer.ok ? { ok: true, value: null } : failure(answer))

const noStore = () => setResponseHeader('cache-control', 'private, no-store')

export const getSignUpPolicy = createServerFn({ method: 'GET' }).handler(() => {
  noStore()
  return { open: env.authSignUp === 'open' }
})

const loginPageAfter = (outcome: AuthOutcome, redirectTo: string) => {
  const search = new URLSearchParams()
  if (redirectTo) {
    search.set('redirect', redirectTo)
  }
  if (!outcome.ok) {
    search.set('error', outcome.failure.code)
  }
  if (!outcome.ok && outcome.failure.retryAfter !== undefined) {
    search.set('retryAfter', String(outcome.failure.retryAfter))
  }
  return search.size > 0 ? `/login?${search}` : '/login'
}

export const signIn = createServerFn({ method: 'POST' })
  .validator(Schema.toStandardSchemaV1(SignInInput))
  .handler(async ({ data }) => done(await callAuthEndpoint('POST', '/sign-in/email', { body: data })))

export const signInFromForm = createServerFn({ method: 'POST' })
  .validator(Schema.toStandardSchemaV1(SignInFormPost))
  .handler(async ({ data }) => {
    const { email, password } = data
    const outcome = done(await callAuthEndpoint('POST', '/sign-in/email', { body: { email, password } }))
    throw redirect({ href: loginPageAfter(outcome, data.redirect), statusCode: 303 })
  })

export const signOut = createServerFn({ method: 'POST' }).handler(async () =>
  done(await callAuthEndpoint('POST', '/sign-out', { body: {} })),
)

export const signUp = createServerFn({ method: 'POST' })
  .validator(Schema.toStandardSchemaV1(SignUpInput))
  .handler(async ({ data }) => done(await callAuthEndpoint('POST', '/sign-up/email', { body: data })))

export const resendVerification = createServerFn({ method: 'POST' })
  .validator(Schema.toStandardSchemaV1(EmailInput))
  .handler(async ({ data }) => done(await callAuthEndpoint('POST', '/send-verification-email', { body: data })))

export const verifyEmail = createServerFn({ method: 'POST' })
  .validator(Schema.toStandardSchemaV1(TokenInput))
  .handler(async ({ data }) => done(await callAuthEndpoint('GET', '/verify-email', { query: { token: data.token } })))

export const requestPasswordReset = createServerFn({ method: 'POST' })
  .validator(Schema.toStandardSchemaV1(EmailInput))
  .handler(async ({ data }) => done(await callAuthEndpoint('POST', '/request-password-reset', { body: data })))

export const resetPassword = createServerFn({ method: 'POST' })
  .validator(Schema.toStandardSchemaV1(ResetPasswordInput))
  .handler(async ({ data }) => done(await callAuthEndpoint('POST', '/reset-password', { body: data })))

export const changePassword = createServerFn({ method: 'POST' })
  .validator(Schema.toStandardSchemaV1(ChangePasswordInput))
  .handler(async ({ data }) =>
    done(await callAuthEndpoint('POST', '/change-password', { body: { ...data, revokeOtherSessions: true } })),
  )

const ListedSession = Schema.Struct({
  createdAt: Schema.String,
  id: Schema.String,
  ipAddress: Schema.NullishOr(Schema.String),
  token: Schema.String,
  updatedAt: Schema.String,
  userAgent: Schema.NullishOr(Schema.String),
})
const decodeSessions = Schema.decodeUnknownSync(Schema.Array(ListedSession))
const decodeCurrent = Schema.decodeUnknownSync(Schema.Struct({ session: Schema.Struct({ id: Schema.String }) }))

export interface SessionView {
  readonly createdAt: string
  readonly current: boolean
  readonly id: string
  readonly ipAddress: string | null
  readonly lastActiveAt: string
  readonly userAgent: string | null
}

const listRaw = async () => {
  const listed = await callAuthEndpoint('GET', '/list-sessions')
  if (!listed.ok) {
    return listed
  }
  return { ok: true as const, sessions: decodeSessions(listed.body) }
}

const sessionViews = (
  sessions: ReadonlyArray<typeof ListedSession.Type>,
  currentId: string,
): ReadonlyArray<SessionView> =>
  sessions
    .map((session) => ({
      createdAt: session.createdAt,
      current: session.id === currentId,
      id: session.id,
      ipAddress: session.ipAddress ? displayClientAddress(session.ipAddress) : null,
      lastActiveAt: session.updatedAt,
      userAgent: session.userAgent ?? null,
    }))
    .toSorted((a, b) => b.lastActiveAt.localeCompare(a.lastActiveAt))

export const listSessions = createServerFn({ method: 'GET' }).handler(
  async (): Promise<AuthOutcome<ReadonlyArray<SessionView>>> => {
    noStore()
    const [listed, current] = await Promise.all([listRaw(), callAuthEndpoint('GET', '/get-session')])
    if (!listed.ok) {
      return failure(listed)
    }
    if (!current.ok) {
      return failure(current)
    }
    if (current.body === null) {
      return { failure: { code: 'UNAUTHORIZED' }, ok: false }
    }
    return { ok: true, value: sessionViews(listed.sessions, decodeCurrent(current.body).session.id) }
  },
)

export const revokeSession = createServerFn({ method: 'POST' })
  .validator(Schema.toStandardSchemaV1(SessionInput))
  .handler(async ({ data }): Promise<AuthOutcome> => {
    const listed = await listRaw()
    if (!listed.ok) {
      return failure(listed)
    }
    const session = listed.sessions.find((candidate) => candidate.id === data.id)
    if (!session) {
      return { ok: true, value: null }
    }
    return done(await callAuthEndpoint('POST', '/revoke-session', { body: { token: session.token } }))
  })

export const revokeOtherSessions = createServerFn({ method: 'POST' }).handler(async () =>
  done(await callAuthEndpoint('POST', '/revoke-other-sessions', { body: {} })),
)

export const signOutEverywhere = createServerFn({ method: 'POST' }).handler(async (): Promise<AuthOutcome> => {
  const revoked = await callAuthEndpoint('POST', '/revoke-sessions', { body: {} })
  if (!revoked.ok) {
    return failure(revoked)
  }
  return done(await callAuthEndpoint('POST', '/sign-out', { body: {} }))
})

export const deleteAccount = createServerFn({ method: 'POST' })
  .validator(Schema.toStandardSchemaV1(DeleteAccountInput))
  .handler(async ({ data }) => done(await callAuthEndpoint('POST', '/delete-user', { body: data })))
