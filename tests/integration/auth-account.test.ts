import { beforeEach, describe, expect, it } from 'vitest'
import type { Json } from '#/contract/json.ts'
import { appUrl, clientIps, createUser, signIn } from './helpers.ts'
import { callAuthFunction } from './server-functions.ts'

const nextIp = clientIps('100.64.5')

let account: Awaited<ReturnType<typeof createUser>>
let cookie: string
beforeEach(async () => {
  account = await createUser('account')
  cookie = await signIn(account, nextIp())
})

const tokenOf = (sessionCookie: string) =>
  decodeURIComponent(sessionCookie.slice(sessionCookie.indexOf('=') + 1)).split('.')[0]!

const sessionUser = async () => {
  const res = await fetch(`${appUrl}/api/auth/get-session`, { headers: { cookie, 'x-forwarded-for': nextIp() } })
  expect(res.status).toBe(200)
  return ((await res.json()) as { user?: { email: string } } | null)?.user ?? null
}

const deleteAccount = (data: Record<string, string>) =>
  callAuthFunction('deleteAccount', { data, headers: { cookie, 'x-forwarded-for': nextIp() } })

describe('/api/auth/* over HTTP', () => {
  it('does not delete a freshly signed-in account without its password', async () => {
    for (const body of ['{}', '{"callbackURL":"/"}', '{"password":""}']) {
      const res = await fetch(`${appUrl}/api/auth/delete-user`, {
        body,
        headers: { 'content-type': 'application/json', cookie, origin: appUrl, 'x-forwarded-for': nextIp() },
        method: 'POST',
      })
      expect(res.status, body).toBe(404)
    }
    expect(await sessionUser()).toMatchObject({ email: account.email })
  })

  it('lists no sessions, and never puts the session token in a body', async () => {
    const list = await fetch(`${appUrl}/api/auth/list-sessions`, { headers: { cookie, 'x-forwarded-for': nextIp() } })
    expect(list.status).toBe(404)

    const session = await fetch(`${appUrl}/api/auth/get-session`, { headers: { cookie, 'x-forwarded-for': nextIp() } })
    const text = await session.text()
    expect(JSON.parse(text)).toMatchObject({
      session: { userId: expect.any(String) as unknown },
      user: { email: account.email },
    })
    expect(text).not.toContain(tokenOf(cookie))

    const res = await fetch(`${appUrl}/api/auth/sign-in/email`, {
      body: JSON.stringify({ email: account.email, password: account.password }),
      headers: { 'content-type': 'application/json', origin: appUrl, 'x-forwarded-for': nextIp() },
      method: 'POST',
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as Json
    expect(body).toMatchObject({ user: { email: account.email } })
    expect(body).not.toHaveProperty('token')
  })
})

describe('account server functions', () => {
  it('list the sessions without their tokens', async () => {
    const { response, value } = await callAuthFunction('listSessions', {
      headers: { cookie, 'x-forwarded-for': nextIp() },
      method: 'GET',
    })
    expect(response.status).toBe(200)
    expect(await response.text()).not.toContain(tokenOf(cookie))
    expect(value).toMatchObject({ ok: true })
    const sessions = value?.ok ? value.value : []
    expect(sessions).toHaveLength(1)
    expect(Object.keys(sessions[0]!).toSorted()).toEqual([
      'createdAt',
      'current',
      'id',
      'ipAddress',
      'lastActiveAt',
      'userAgent',
    ])
    expect(sessions[0]).toMatchObject({ current: true })
  })

  it('refuse to delete the account without the password or with a wrong one', async () => {
    expect((await deleteAccount({})).thrown).toBe('Internal error')
    expect((await deleteAccount({ password: '' })).thrown).toBe('Internal error')
    const wrong = await deleteAccount({ password: 'not-the-password-123' })
    expect(wrong.value).toEqual({ failure: { code: 'INVALID_PASSWORD' }, ok: false })
    expect(await sessionUser()).toMatchObject({ email: account.email })

    expect((await deleteAccount({ password: account.password })).value).toEqual({ ok: true, value: null })
    expect(await sessionUser()).toBeNull()
  })
})
