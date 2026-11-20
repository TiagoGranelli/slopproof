import '@tanstack/react-start/server-only'
import { Cause, Effect, Layer, SchemaIssue } from 'effect'
import { HttpRouter, HttpServer, HttpServerRequest, HttpServerResponse } from 'effect/http'
import { HttpApiBuilder, HttpApiError } from 'effect/http-api'
import { Api } from '#/contract/api.ts'
import { UserId } from '#/contract/ids.ts'
import { Database } from '../db/client.ts'
import { DatabaseHealth } from '../db/health.ts'
import { requestSession } from '../http/request-session.ts'
import { onShutdown } from '../lifecycle.ts'
import { log } from '../log.ts'
import { PostsRepo } from '../posts/repo.ts'
import { ApiHandlers } from './handlers.ts'
import { AuthenticationLive, issuePath, RequestValidationLive } from './middleware.ts'
import { RateLimitStore, WriteRateLimitLive } from './rate-limit.ts'
import { SessionLookup } from './session-lookup.ts'

const formatIssues = SchemaIssue.makeFormatterStandardSchemaV1()

const describeSchemaDefect = (defect: HttpApiError.HttpApiSchemaError): Error => {
  const paths = formatIssues(defect.cause.issue).issues.map((issue) => issuePath(issue).join('.'))
  return Object.assign(
    new Error(`Response ${defect.kind.toLowerCase()} does not match its schema at: ${paths.join(', ')}`),
    {
      name: 'ResponseSchemaError',
    },
  )
}

const logDefect = (request: HttpServerRequest.HttpServerRequest, cause: Cause.Cause<unknown>) => {
  const defect = Cause.squash(cause)
  log('error', 'api defect', {
    error: HttpApiError.HttpApiSchemaError.is(defect) ? describeSchemaDefect(defect) : defect,
    method: request.method,
    path: request.url.split('?')[0],
  })
}

const ServerMiddleware = HttpRouter.middleware(
  (httpEffect) =>
    Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest
      return yield* httpEffect.pipe(
        Effect.catchCause((cause) => {
          if (!Cause.hasDies(cause)) {
            return Effect.failCause(cause)
          }
          logDefect(request, cause)
          return Effect.succeed(HttpServerResponse.empty({ status: 500 }))
        }),
        Effect.map((response) =>
          response.headers['cache-control']
            ? response
            : HttpServerResponse.setHeader(response, 'cache-control', 'no-store'),
        ),
      )
    }),
  { global: true },
)

const SessionLookupLive = Layer.succeed(SessionLookup, {
  userOf: (headers) =>
    Effect.tryPromise(() => requestSession(headers)).pipe(
      Effect.orDie,
      Effect.map((session) =>
        session ? { email: session.user.email, id: UserId.make(session.user.id), name: session.user.name } : null,
      ),
    ),
})

const ApiLive = HttpApiBuilder.layer(Api, { openapiPath: '/api/openapi.json' }).pipe(
  Layer.provide(ApiHandlers),
  Layer.provide([
    Layer.mergeAll(DatabaseHealth.layer, PostsRepo.layer).pipe(Layer.provide(Database.layer)),
    AuthenticationLive.pipe(Layer.provide(SessionLookupLive)),
    RequestValidationLive,
    WriteRateLimitLive.pipe(Layer.provide(RateLimitStore.postgres)),
  ]),
  Layer.merge(ServerMiddleware),
)

const { dispose, handler } = HttpRouter.toWebHandler(ApiLive.pipe(Layer.provide(HttpServer.layerServices)), {
  disableLogger: true,
})
onShutdown('effect-api', dispose)

export const apiHandler = handler
