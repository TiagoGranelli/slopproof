import { Effect, Layer } from 'effect'
import { afterAll, describe, expect, it } from 'vitest'
import type { Json } from '#/contract/json.ts'
import { auth } from '#/server/auth.ts'
import { pool } from '#/server/db/client.ts'
import { DatabaseHealth } from '#/server/db/health.ts'
import { env } from '#/server/env.ts'
import { createAccount, expectBudget, recordingDatabase, statementsOf, withBudget } from './helpers.ts'

afterAll(() => pool.end())

describe('DatabaseHealth', () => {
  it('pings in one statement', async () => {
    const health = DatabaseHealth.layer.pipe(Layer.provide(recordingDatabase))
    const ping = Effect.gen(function* () {
      return yield* (yield* DatabaseHealth).ping
    })
    await expect(withBudget('ping', 1, ping.pipe(Effect.provide(health)))).resolves.toBeUndefined()
  })
})

type Endpoint = `${'GET' | 'POST'} /${string}`

const request = (endpoint: Endpoint, cookie: string, body: Json = {}) => {
  const [method, path] = endpoint.split(' ') as ['GET' | 'POST', string]
  return auth.handler(
    new Request(`${env.appUrl}/api/auth${path}`, {
      body: method === 'POST' ? JSON.stringify(body) : null,
      headers:
        method === 'POST'
          ? { 'content-type': 'application/json', cookie, origin: env.appUrl }
          : { cookie, origin: env.appUrl },
      method,
    }),
  )
}

const signedIn = async (others: number) => {
  const account = await createAccount(`sessions-${others}`)
  const response = await auth.handler(
    new Request(`${env.appUrl}/api/auth/sign-in/email`, {
      body: JSON.stringify({ email: account.email, password: account.password }),
      headers: { 'content-type': 'application/json', origin: env.appUrl },
      method: 'POST',
    }),
  )
  expect(response.status).toBe(200)
  const cookie = response.headers
    .getSetCookie()
    .map((c) => c.split(';')[0]!)
    .join('; ')
  const context = await auth.$context
  for (let i = 0; i < others; i++) {
    await context.internalAdapter.createSession(account.id)
  }
  return { cookie, password: account.password }
}

describe('session endpoints', () => {
  const BUDGETS = {
    'GET /list-sessions': () => 3,
    'POST /change-password': () => 7,
    'POST /revoke-other-sessions': (others: number) => 3 + 2 * others,
    'POST /revoke-sessions': () => 4,
  }
  const bodies: Partial<Record<keyof typeof BUDGETS, (password: string) => Json>> = {
    'POST /change-password': (password) => ({
      currentPassword: password,
      newPassword: `new-${password}`,
      revokeOtherSessions: true,
    }),
  }

  it('lists the cookie session and the others, so the budgets below count 1 session and 21', async () => {
    for (const others of [0, 20]) {
      const { cookie } = await signedIn(others)
      expect(await (await request('GET /list-sessions', cookie)).json()).toHaveLength(others + 1)
    }
  })

  it.each(Object.keys(BUDGETS) as Array<keyof typeof BUDGETS>)(
    'answers %s within its budget for 1 session and for 21',
    async (what) => {
      for (const others of [0, 20]) {
        const { cookie, password } = await signedIn(others)
        const body = bodies[what]?.(password)
        const { returned: response, statements } = await statementsOf(() => request(what, cookie, body))
        expect(response.status, `${what} with ${others + 1} sessions`).toBe(200)
        expectBudget(`${what} with ${others + 1} sessions`, statements, BUDGETS[what](others))
      }
    },
  )
})
