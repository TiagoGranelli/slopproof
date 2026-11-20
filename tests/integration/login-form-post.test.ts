import { beforeAll, describe, expect, it } from 'vitest'
import { appUrl, clientIps, createUser, sessionCookie } from './helpers.ts'
import { authFunctionPath } from './server-functions.ts'

const nextIp = clientIps('100.64.7')

let account: { email: string; password: string }
beforeAll(async () => {
  account = await createUser('form-post')
})

const postForm = (fields: Record<string, string>, origin = appUrl) =>
  fetch(new URL(authFunctionPath('signInFromForm'), appUrl), {
    body: new URLSearchParams(fields),
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      origin,
      'sec-fetch-mode': 'navigate',
      'sec-fetch-site': origin === appUrl ? 'same-origin' : 'cross-site',
      'x-forwarded-for': nextIp(),
    },
    method: 'POST',
    redirect: 'manual',
  })

describe('the login form posted without JavaScript', () => {
  it('signs in and sends the visitor back to /login with the session, which goes on to the target', async () => {
    const res = await postForm({ email: account.email, password: account.password, redirect: '/account' })
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toBe('/login?redirect=%2Faccount')
    const cookie = sessionCookie(res)
    expect(cookie).toBeDefined()

    const next = await fetch(new URL('/login?redirect=%2Faccount', appUrl), {
      headers: { cookie: cookie! },
      redirect: 'manual',
    })
    expect(next.status).toBeGreaterThanOrEqual(300)
    expect(next.status).toBeLessThan(400)
    expect(new URL(next.headers.get('location')!, appUrl).pathname).toBe('/account')
  })

  it('answers a wrong password with its code in the URL and no session', async () => {
    const res = await postForm({ email: account.email, password: 'not the password at all', redirect: '' })
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toBe('/login?error=INVALID_EMAIL_OR_PASSWORD')
    expect(sessionCookie(res)).toBeUndefined()
  })

  it('refuses a post from another site before it reaches Better Auth', async () => {
    const res = await postForm(
      { email: account.email, password: account.password, redirect: '' },
      'https://evil.example',
    )
    expect(res.status).toBe(403)
    expect(sessionCookie(res)).toBeUndefined()
  })
})
