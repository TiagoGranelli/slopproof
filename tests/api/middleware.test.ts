import { assert, describe, expect, it, onTestFinished } from '@effect/vitest'
import { Effect, Layer, Schema } from 'effect'
import { HttpRouter, HttpServer } from 'effect/http'
import { HttpApi, HttpApiBuilder, HttpApiEndpoint, HttpApiError, HttpApiGroup, HttpApiSchema } from 'effect/http-api'
import { ValidationError } from '#/contract/errors.ts'
import { WRITE_WINDOW_SECONDS, WRITES_PER_WINDOW } from '#/contract/limits.ts'
import { Authentication, RequestValidation, WriteRateLimit } from '#/contract/middleware.ts'
import { RequestValidationLive } from '#/server/api/middleware.ts'
import { WriteRateLimitLive } from '#/server/api/rate-limit.ts'
import { AuthenticationOverFakeSessions, memoryRateLimitStore } from './harness.ts'

class Probe extends HttpApiGroup.make('probe')
  .add(
    HttpApiEndpoint.post('write', '/probe', {
      payload: Schema.Struct({ value: Schema.String.check(Schema.isMinLength(1)) }),
      success: HttpApiSchema.NoContent,
    })
      .middleware(RequestValidation)
      .middleware(WriteRateLimit),
  )
  .middleware(Authentication) {}
class ProbeApi extends HttpApi.make('probe').add(Probe) {}

const ProbeHandlers = HttpApiBuilder.group(ProbeApi, 'probe', (handlers) => handlers.handle('write', () => Effect.void))

const probe = () => {
  const handlers = ProbeHandlers.pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        AuthenticationOverFakeSessions,
        RequestValidationLive,
        WriteRateLimitLive.pipe(Layer.provide(memoryRateLimitStore)),
      ),
    ),
    Layer.merge(HttpServer.layerServices),
  )
  const web = HttpRouter.toWebHandler(HttpApiBuilder.layer(ProbeApi).pipe(Layer.provide(handlers)), {
    disableLogger: true,
  })
  onTestFinished(web.dispose)
  return async (session: string | undefined, body: string) => {
    const response = await web.handler(
      new Request('http://localhost:3000/probe', {
        body,
        headers: session
          ? { 'content-type': 'application/json', cookie: `better-auth.session_token=${session}` }
          : { 'content-type': 'application/json' },
        method: 'POST',
      }),
    )
    const text = await response.text()
    return { json: text ? (JSON.parse(text) as unknown) : undefined, status: response.status }
  }
}

const valid = JSON.stringify({ value: 'x' })

describe('RequestValidation on an endpoint', () => {
  it('answers an invalid payload with the rule it broke, never the value', async () => {
    const send = probe()
    expect(await send('alice', JSON.stringify({ value: '' }))).toEqual({
      json: {
        _tag: 'ValidationError',
        issues: [{ message: 'Expected a value with a length of at least 1', path: ['value'] }],
        message: 'Invalid request payload',
      },
      status: 400,
    })
    const malformed = await send('alice', '{"value": "secret-value')
    expect(malformed).toMatchObject({
      json: { _tag: 'ValidationError', message: 'Invalid request payload' },
      status: 400,
    })
    expect(JSON.stringify(malformed.json)).not.toContain('secret-value')
  })

  it('runs after Authentication: without a session the answer is 401 whatever the body', async () => {
    const send = probe()
    for (const body of [valid, '{']) {
      expect(await send(undefined, body)).toEqual({
        json: { _tag: 'Unauthorized', message: 'Authentication required' },
        status: 401,
      })
    }
  })
})

describe('WriteRateLimit on an endpoint', () => {
  it('admits the limit per user, then answers 429 with the computed wait, before reading the body', async () => {
    const send = probe()
    for (let i = 0; i < WRITES_PER_WINDOW; i++) {
      expect((await send('alice', valid)).status).toBe(204)
    }
    for (const [index, body] of [valid, '{', JSON.stringify({ value: '' })].entries()) {
      expect(await send('alice', body)).toEqual({
        json: {
          _tag: 'RateLimited',
          message: 'Too many changes in a short time',
          retryAfter: WRITE_WINDOW_SECONDS - 1 - index,
        },
        status: 429,
      })
    }
    expect((await send('bob', valid)).status).toBe(204)
  })
})

describe('RequestValidation middleware', () => {
  type Middleware = (effect: Effect.Effect<never, unknown>, options: never) => Effect.Effect<unknown, unknown>
  const schemaError = Schema.decodeUnknownEffect(Schema.Struct({ id: Schema.String }))({ id: 1 }).pipe(Effect.flip)
  const run = (kind: HttpApiError.HttpApiSchemaError['kind']) =>
    Effect.gen(function* () {
      // Direct middleware invocation bypasses HttpRouter.Provided and unhandled failure typing.
      // oxlint-disable-next-line quality/no-chained-type-assertions
      const middleware = (yield* RequestValidation) as unknown as Middleware
      const failure = new HttpApiError.HttpApiSchemaError({ cause: yield* schemaError, kind })
      return yield* middleware(Effect.fail(failure), undefined as never).pipe(Effect.flip)
    }).pipe(Effect.provide(RequestValidationLive))

  it.effect.each(['Params', 'Headers', 'Query', 'Payload'] as const)('maps %s decoding failures', (kind) =>
    Effect.gen(function* () {
      const error = yield* run(kind)
      assert.instanceOf(error, ValidationError)
      assert.deepStrictEqual(
        { issues: error.issues, message: error.message },
        { issues: [{ message: 'Expected string', path: ['id'] }], message: `Invalid request ${kind.toLowerCase()}` },
      )
    }),
  )

  it.effect.each(['Body', 'ResponseHeaders'] as const)('passes %s encoding failures through', (kind) =>
    Effect.gen(function* () {
      const error = yield* run(kind)
      assert.isTrue(HttpApiError.HttpApiSchemaError.is(error))
    }),
  )
})
