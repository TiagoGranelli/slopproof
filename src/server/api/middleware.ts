import '@tanstack/react-start/server-only'
import { Effect, Layer, Redacted, SchemaIssue } from 'effect'
import { HttpServerRequest } from 'effect/http'
import { HttpApiError } from 'effect/http-api'
import { Unauthorized, ValidationError } from '#/contract/errors.ts'
import { Authentication, CurrentUser, RequestValidation } from '#/contract/middleware.ts'
import { SessionLookup } from './session-lookup.ts'

const webHeaders = (incoming: Readonly<Record<string, string>>): Headers => new Headers(Object.entries(incoming))

const authenticationRequired = () => new Unauthorized({ message: 'Authentication required' })

export const AuthenticationLive = Layer.effect(
  Authentication,
  Effect.gen(function* () {
    const sessions = yield* SessionLookup
    const authenticate: Authentication['Service']['sessionCookie'] = (httpEffect, { credential }) =>
      Effect.gen(function* () {
        if (Redacted.value(credential) === '') {
          return yield* authenticationRequired()
        }
        const request = yield* HttpServerRequest.HttpServerRequest
        const user = yield* sessions.userOf(webHeaders(request.headers))
        if (!user) {
          return yield* authenticationRequired()
        }
        return yield* Effect.provideService(httpEffect, CurrentUser, user)
      })
    return { secureSessionCookie: authenticate, sessionCookie: authenticate }
  }),
)

const formatIssues = SchemaIssue.makeFormatterStandardSchemaV1()
type FormattedIssue = ReturnType<typeof formatIssues>['issues'][number]

export const issuePath = (issue: FormattedIssue): Array<string> =>
  issue.path?.map((segment) => String(typeof segment === 'object' ? segment.key : segment)) ?? []

const REQUEST_KINDS = new Set<HttpApiError.HttpApiSchemaError['kind']>(['Params', 'Headers', 'Query', 'Payload'])

const toValidationError = <E>(error: E): E | ValidationError => {
  const failure: unknown = error
  if (!HttpApiError.HttpApiSchemaError.is(failure) || !REQUEST_KINDS.has(failure.kind)) {
    return error
  }
  const issues = formatIssues(failure.cause.issue).issues.map((issue) => ({
    message: issue.message,
    path: issuePath(issue),
  }))
  return new ValidationError({ issues, message: `Invalid request ${failure.kind.toLowerCase()}` })
}

export const RequestValidationLive = Layer.succeed(RequestValidation, (httpEffect) =>
  httpEffect.pipe(Effect.mapError(toValidationError)),
)
