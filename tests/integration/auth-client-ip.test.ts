import { describe, expect, it } from 'vitest'
import { appUrl, closedAppUrl, postSignIn, sessionCookie, sharedUsers } from './helpers.ts'
import { callAuthFunction } from './server-functions.ts'

const { email, password } = sharedUsers.author

const sessionIp = async (baseUrl: string, cookie: string) => {
  const { value } = await callAuthFunction('listSessions', { baseUrl, headers: { cookie }, method: 'GET' })
  expect(value?.ok).toBe(true)
  return value?.ok ? value.value.find((session) => session.current)?.ipAddress : undefined
}

describe('client IP behind a trusted proxy', () => {
  it('is the last X-Forwarded-For hop the trusted peer vouches for', async () => {
    const res = await postSignIn(sharedUsers.author, { 'x-forwarded-for': '203.0.113.50, 100.64.1.7' })
    expect(res.status).toBe(200)
    expect(await sessionIp(appUrl, sessionCookie(res)!)).toBe('100.64.1.7')
  })

  it('is an IPv6 client’s /64 network, which is also its rate-limit bucket', async () => {
    const res = await postSignIn(sharedUsers.author, { 'x-forwarded-for': '2001:db8:64:1:aaaa:bbbb:cccc:dddd' })
    expect(res.status).toBe(200)
    expect(await sessionIp(appUrl, sessionCookie(res)!)).toBe('2001:db8:64:1::/64')

    const statuses: Array<number> = []
    for (const address of ['2001:db8:64:1::2', '2001:db8:64:1:ffff::1', '2001:db8:64:1::3']) {
      statuses.push(
        (await postSignIn({ email, password: 'wrong-password-123' }, { 'x-forwarded-for': address })).status,
      )
    }
    expect(statuses).toEqual([401, 401, 429])
  })
})

describe('client IP from a peer outside TRUSTED_PROXIES', () => {
  const direct = new URL(closedAppUrl)
  direct.hostname = '127.0.0.1'
  const signIn = (spoofed: string, pass = password) =>
    fetch(`${direct.origin}/api/auth/sign-in/email`, {
      body: JSON.stringify({ email, password: pass }),
      headers: { 'content-type': 'application/json', origin: closedAppUrl, 'x-forwarded-for': spoofed },
      method: 'POST',
    })

  it('ignores a spoofed X-Forwarded-For for the session and the sign-in rate limit', async () => {
    const res = await signIn('100.64.1.99')
    expect(res.status).toBe(200)
    expect(await sessionIp(direct.origin, sessionCookie(res)!)).toBe('127.0.0.1')

    const statuses: Array<number> = []
    for (const spoofed of ['100.64.1.100', '100.64.1.101, 10.0.0.1', '100.64.1.102']) {
      statuses.push((await signIn(spoofed, 'wrong-password-123')).status)
    }
    expect(statuses).toEqual([401, 401, 429])
  })
})
