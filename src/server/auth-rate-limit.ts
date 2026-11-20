import '@tanstack/react-start/server-only'
import type { BetterAuthOptions } from 'better-auth'
import { lt, sql } from 'drizzle-orm'
import { runInBackground } from './background-tasks.ts'
import { db } from './db/client.ts'
import { rateLimit } from './db/schema/rate-limit.ts'

type RateLimitStorage = NonNullable<NonNullable<BetterAuthOptions['rateLimit']>['customStorage']>

const IDLE_ROW_MS = 10 * 60 * 1000
let lastPrune = 0

const pruneIdleRows = (now: number): void => {
  if (now - lastPrune <= IDLE_ROW_MS) {
    return
  }
  lastPrune = now
  runInBackground(db.delete(rateLimit).where(lt(rateLimit.lastRequest, now - IDLE_ROW_MS)))
}

const countRequest = async (key: string, rule: { readonly max: number; readonly window: number }, now: number) => {
  const expired = sql`${rateLimit.lastRequest} <= ${now - rule.window * 1000}`
  const [row] = await db
    .insert(rateLimit)
    .values({ count: 1, key, lastRequest: now })
    .onConflictDoUpdate({
      set: {
        count: sql`case when ${expired} then 1 else ${rateLimit.count} + 1 end`,
        lastRequest: sql`case when ${expired} or ${rateLimit.count} < ${rule.max} then ${now} else ${rateLimit.lastRequest} end`,
      },
      target: rateLimit.key,
    })
    .returning({ count: rateLimit.count, lastRequest: rateLimit.lastRequest })
  return row
}

export const postgresRateLimitStorage: RateLimitStorage = {
  async consume(key, rule) {
    const now = Date.now()
    const windowMs = rule.window * 1000
    const row = await countRequest(key, rule, now)
    pruneIdleRows(now)
    if (row && row.count <= rule.max) {
      return { allowed: true, retryAfter: null }
    }
    const lastRequest = row?.lastRequest ?? now
    return { allowed: false, retryAfter: Math.max(1, Math.ceil((lastRequest + windowMs - now) / 1000)) }
  },
}
