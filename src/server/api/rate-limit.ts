import '@tanstack/react-start/server-only'
import { Context, Effect, Layer } from 'effect'
import { RateLimited } from '#/contract/errors.ts'
import { WRITE_WINDOW_SECONDS, WRITES_PER_WINDOW } from '#/contract/limits.ts'
import { CurrentUser, WriteRateLimit } from '#/contract/middleware.ts'
import { postgresRateLimitStorage } from '../auth-rate-limit.ts'

interface Rule {
  readonly max: number
  /** Seconds. */
  readonly window: number
}

interface Decision {
  readonly allowed: boolean
  /** Seconds until a refused request would be admitted. */
  readonly retryAfter: number | null
}

/** Counts requests per key within a window, atomically across instances. */
export class RateLimitStore extends Context.Service<
  RateLimitStore,
  { readonly consume: (key: string, rule: Rule) => Effect.Effect<Decision> }
>()('app/RateLimitStore') {
  /**
   * The rate_limit table Better Auth's own limits use, with the same atomic upsert (../auth-rate-limit.ts).
   * Keys of the business API start with `api-write|`, which no Better Auth key (`<ip>|<path>`) does. A
   * database failure is a defect: the request answers 500, as the write itself would.
   */
  static readonly postgres = Layer.succeed(RateLimitStore, {
    consume: (key, rule) => Effect.promise(() => postgresRateLimitStorage.consume(key, rule)),
  })
}

const WRITES: Rule = { max: WRITES_PER_WINDOW, window: WRITE_WINDOW_SECONDS }

/**
 * Open sign-up means anyone can hold a session, so writes are limited per user, not per IP: a bucket per
 * account, shared by all of its sessions and instances.
 */
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
