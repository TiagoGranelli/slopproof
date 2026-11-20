import '@tanstack/react-start/server-only'
import { Context, Effect, Layer } from 'effect'
import { RateLimited } from '#/contract/errors.ts'
import { WRITE_WINDOW_SECONDS, WRITES_PER_WINDOW } from '#/contract/limits.ts'
import { CurrentUser, WriteRateLimit } from '#/contract/middleware.ts'
import { postgresRateLimitStorage } from '../auth-rate-limit.ts'

interface Rule {
  readonly max: number
  readonly window: number
}

interface Decision {
  readonly allowed: boolean
  readonly retryAfter: number | null
}

export class RateLimitStore extends Context.Service<
  RateLimitStore,
  { readonly consume: (key: string, rule: Rule) => Effect.Effect<Decision> }
>()('app/RateLimitStore') {
  static readonly postgres = Layer.succeed(RateLimitStore, {
    consume: (key, rule) => Effect.promise(() => postgresRateLimitStorage.consume(key, rule)),
  })
}

const WRITES: Rule = { max: WRITES_PER_WINDOW, window: WRITE_WINDOW_SECONDS }

export const WriteRateLimitLive = Layer.effect(
  WriteRateLimit,
  Effect.gen(function* () {
    const store = yield* RateLimitStore
    return (httpEffect) =>
      Effect.gen(function* () {
        const user = yield* CurrentUser
        const decision = yield* store.consume(`api-write|${user.id}`, WRITES)
        if (!decision.allowed) {
          return yield* new RateLimited({
            message: 'Too many changes in a short time',
            retryAfter: decision.retryAfter ?? WRITES.window,
          })
        }
        return yield* httpEffect
      })
  }),
)
