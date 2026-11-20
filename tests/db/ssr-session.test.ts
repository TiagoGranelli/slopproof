import { createServerEntry, getRequestHeaders } from '@tanstack/react-start/server'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { meGet } from '#/sdk/sdk.gen.ts'
import { createInProcessApiClient } from '#/server/api/in-process-client.ts'
import { auth } from '#/server/auth.ts'
import { pool } from '#/server/db/client.ts'
import { env } from '#/server/env.ts'
import { requestSession } from '#/server/http/request-session.ts'
import { createAccount, expectBudget, statementsOf } from './helpers.ts'

afterAll(() => pool.end())

const signIn = async (label: string) => {
  const account = await createAccount(label)
  const response = await auth.handler(
    new Request(`${env.appUrl}/api/auth/sign-in/email`, {
      body: JSON.stringify({ email: account.email, password: account.password }),
      headers: { 'content-type': 'application/json', origin: env.appUrl },
      method: 'POST',
    }),
  )
  expect(response.status).toBe(200)
  return response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(';')[0]!)
    .join('; ')
}

const serve = async <T>(cookie: string, work: () => Promise<T>): Promise<T> => {
  const returned: Array<T> = []
  await createServerEntry({
    fetch: async () => {
      returned.push(await work())
      return new Response(null, { status: 204 })
    },
  }).fetch(new Request(`${env.appUrl}/dashboard`, { headers: { cookie } }), {})
  return returned[0]!
}

const touchesSession = (sql: string) => sql.includes('"session"')

const sendWrite = async () => {
  const { error } = await createInProcessApiClient().post({ url: '/api/me' })
  return error instanceof Error ? error.message : 'sent'
}

let cookie: string
let otherCookie: string
let lookup: number
beforeAll(async () => {
  ;[cookie, otherCookie] = await Promise.all([signIn('ssr-session'), signIn('ssr-session-other')])
  const { statements } = await statementsOf(() => auth.api.getSession({ headers: new Headers({ cookie }) }))
  lookup = statements.length
  expect(statements.some((sql) => touchesSession(sql))).toBe(true)
})

describe('an authed SSR page', () => {
  it('looks the session up once for the guard and the API calls of its loaders together', async () => {
    const { returned: page, statements } = await statementsOf(() =>
      serve(cookie, async () => {
        const guard = await requestSession(getRequestHeaders())
        const me = await meGet({ client: createInProcessApiClient() })
        return { signedIn: guard !== null, status: me.response?.status }
      }),
    )
    expect(page).toEqual({ signedIn: true, status: 200 })
    expectBudget('an authed SSR page', statements, lookup)
  })

  it('keeps lookups apart per request and per cookie', async () => {
    const twice = await statementsOf(async () => {
      await serve(cookie, () => requestSession(getRequestHeaders()))
      await serve(cookie, () => requestSession(getRequestHeaders()))
    })
    expectBudget('two requests', twice.statements, 2 * lookup)

    const { returned: emails, statements } = await statementsOf(() =>
      serve(cookie, async () => {
        const [mine, theirs] = await Promise.all([
          requestSession(new Headers({ cookie })),
          requestSession(new Headers({ cookie: otherCookie })),
        ])
        return [mine?.user.email, theirs?.user.email]
      }),
    )
    expect(new Set(emails).size).toBe(2)
    expectBudget('two cookies in one request', statements, 2 * lookup)
  })

  it('refuses a write through the in-process client before it reaches the API', async () => {
    const { returned: refusal, statements } = await statementsOf(() => serve(cookie, sendWrite))
    expect(refusal).toMatch(/^The in-process API client only sends GET \(got POST \/api\/me\)/)
    expectBudget('a refused write', statements, 0)
  })
})
