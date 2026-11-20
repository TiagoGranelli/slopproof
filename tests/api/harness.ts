import { appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { Effect, Layer } from 'effect'
import {
  HttpClient,
  HttpClientRequest,
  HttpRouter,
  HttpServer,
  HttpServerRequest,
  HttpServerResponse,
} from 'effect/http'
import { HttpApiBuilder, HttpApiClient, HttpApiMiddleware } from 'effect/http-api'
import { Api } from '#/contract/api.ts'
import { UserId } from '#/contract/ids.ts'
import { Authentication } from '#/contract/middleware.ts'
import { ApiHandlers } from '#/server/api/handlers.ts'
import { AuthenticationLive, RequestValidationLive } from '#/server/api/middleware.ts'
import { RateLimitStore, WriteRateLimitLive } from '#/server/api/rate-limit.ts'
import { SessionLookup } from '#/server/api/session-lookup.ts'
import { DatabaseHealth } from '#/server/db/health.ts'
import { memoryQuery, type RepoOptions } from './memory-db.ts'
import { memoryPostsRepo } from './posts-repo.ts'

export const authors = {
  alice: { email: 'alice@example.test', id: UserId.make('user-alice'), name: 'Alice' },
  bob: { email: 'bob@example.test', id: UserId.make('user-bob'), name: 'Bob' },
}
type AuthorName = keyof typeof authors

const memoryDatabaseHealth = (options: RepoOptions) =>
  Layer.succeed(DatabaseHealth, { ping: memoryQuery(options)(() => undefined) })

const sessionToken = (headers: Headers) =>
  /(?:^|;\s*)(?:__Secure-)?better-auth\.session_token=([^;]*)/.exec(headers.get('cookie') ?? '')?.[1]

export const FakeSessionLookup = Layer.succeed(SessionLookup, {
  userOf: (headers) =>
    Effect.sync(() => {
      const token = sessionToken(headers)
      return token !== undefined && Object.hasOwn(authors, token) ? authors[token as AuthorName] : null
    }),
})

export const AuthenticationOverFakeSessions: Layer.Layer<Authentication> = AuthenticationLive.pipe(
  Layer.provide(FakeSessionLookup),
)

export const memoryRateLimitStore = Layer.sync(RateLimitStore, () => {
  const buckets = new Map<string, { count: number; lastRequest: number }>()
  let now = 0
  return {
    consume: (key, rule) =>
      Effect.sync(() => {
        now += 1000
        const windowMs = rule.window * 1000
        const bucket = buckets.get(key)
        const expired = !bucket || bucket.lastRequest <= now - windowMs
        const count = expired ? 1 : bucket.count + 1
        const lastRequest = expired || bucket.count < rule.max ? now : bucket.lastRequest
        buckets.set(key, { count, lastRequest })
        if (count <= rule.max) {
          return { allowed: true, retryAfter: null }
        }
        return { allowed: false, retryAfter: Math.max(1, Math.ceil((lastRequest + windowMs - now) / 1000)) }
      }),
  }
})

export const apiLayer = (options: RepoOptions = {}) =>
  ApiHandlers.pipe(
    Layer.provide(Layer.mergeAll(memoryDatabaseHealth(options), memoryPostsRepo(options))),
    Layer.provideMerge(
      Layer.mergeAll(
        AuthenticationOverFakeSessions,
        RequestValidationLive,
        WriteRateLimitLive.pipe(Layer.provide(memoryRateLimitStore)),
      ),
    ),
    Layer.merge(HttpServer.layerServices),
  )

export const webHandler = (options: RepoOptions = {}) => {
  const web = HttpRouter.toWebHandler(HttpApiBuilder.layer(Api).pipe(Layer.provide(apiLayer(options))), {
    disableLogger: true,
  })
  return {
    dispose: web.dispose,
    handler: async (request: Request) => {
      const response = await web.handler(request)
      observe(request.method, request.url, response.status)
      return response
    },
  }
}

const session = (token: Session) =>
  HttpApiMiddleware.layerClient(Authentication, ({ next, request }) =>
    next(
      token === 'none' ? request : HttpClientRequest.setHeader(request, 'cookie', `better-auth.session_token=${token}`),
    ),
  )
type Session = AuthorName | 'forged' | 'none'

export const clientAs = (token: Session) =>
  Effect.gen(function* () {
    const handler = yield* HttpRouter.toHttpEffect(HttpApiBuilder.layer(Api))
    const httpClient = HttpClient.make((request) =>
      Effect.gen(function* () {
        const response = yield* handler.pipe(
          Effect.provideService(HttpServerRequest.HttpServerRequest, HttpServerRequest.fromClientRequest(request)),
          Effect.orDie,
        )
        observe(request.method, request.url, response.status)
        return HttpServerResponse.toClientResponse(response, { request })
      }).pipe(Effect.scoped),
    )
    return yield* HttpApiClient.makeWith(Api, { baseUrl: 'http://localhost:3000', httpClient })
  }).pipe(Effect.provide(session(token)))

const observe = (method: string, url: string, status: number) => {
  const directory = process.env.CONTRACT_OBSERVATIONS
  if (!directory) {
    return
  }
  mkdirSync(directory, { recursive: true })
  const line = JSON.stringify({ method, path: new URL(url).pathname, status })
  appendFileSync(join(directory, `api-${process.pid}.jsonl`), `${line}\n`)
}
