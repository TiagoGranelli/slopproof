import { beforeAll, describe, expect, it } from 'vitest'
import { appUrl, clientIps, postSignIn, sessionCookie, signIn, sharedUsers } from './helpers.ts'

const nextIp = clientIps('198.51.100')
const { email, password } = sharedUsers.author

const me = (cookie: string) => fetch(`${appUrl}/api/me`, { headers: { cookie } })

let cookie: string

beforeAll(async () => {
  cookie = await signIn(sharedUsers.author, nextIp())
})

describe('headers', () => {
  it('gives SSR pages a nonce-based CSP that covers every script', async () => {
    const res = await fetch(appUrl)
    const csp = res.headers.get('content-security-policy') ?? ''
    const nonce = csp.match(/script-src 'self' 'nonce-([^']+)'/)?.[1]
    expect(nonce).toBeTruthy()
    expect(csp).not.toMatch(/script-src[^;]*'unsafe-(inline|eval)'/)
    expect(csp).toContain("frame-ancestors 'none'")
    expect(csp).toContain("object-src 'none'")
    expect(res.headers.get('cross-origin-opener-policy')).toBe('same-origin')
    const scripts = [...(await res.text()).matchAll(/<script\b[^>]*>/g)].map((m) => m[0])
    expect(scripts.length).toBeGreaterThan(0)
    for (const tag of scripts) {
      expect(tag).toContain(`nonce="${nonce}"`)
    }
    const again = (await fetch(appUrl)).headers.get('content-security-policy')
    expect(again).not.toContain(nonce!)
  })

  it('sends security headers on static files and prerendered pages too', async () => {
    for (const path of ['/about', '/favicon.svg']) {
      const res = await fetch(appUrl + path)
      expect(res.status, path).toBe(200)
      expect(res.headers.get('x-content-type-options'), path).toBe('nosniff')
      expect(res.headers.get('x-frame-options'), path).toBe('DENY')
      expect(res.headers.get('cross-origin-opener-policy'), path).toBe('same-origin')
      expect(res.headers.get('content-security-policy'), path).toContain("frame-ancestors 'none'")
    }
  })

  it('keeps per-user API responses out of caches', async () => {
    const res = await me(cookie)
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
  })
})

describe('csrf', () => {
  const attempts: Array<[string, Record<string, string>]> = [
    ['cross-site fetch metadata, even with our origin', { origin: appUrl, 'sec-fetch-site': 'cross-site' }],
    ['same-site (sibling subdomain)', { origin: appUrl, 'sec-fetch-site': 'same-site' }],
    ['foreign origin', { origin: 'https://evil.example' }],
    ['no origin, referer or fetch metadata', {}],
  ]
  it.each(attempts)('rejects sign-in with %s', async (_, headers) => {
    const res = await fetch(`${appUrl}/api/auth/sign-in/email`, {
      body: JSON.stringify({ email, password }),
      headers: { 'content-type': 'application/json', 'x-forwarded-for': nextIp(), ...headers },
      method: 'POST',
    })
    expect(res.status).toBe(403)
  })

  it('rejects cross-site server function calls before they run', async () => {
    const res = await fetch(`${appUrl}/_serverFn/anything`, {
      body: '{}',
      headers: { 'content-type': 'application/json', cookie, origin: 'https://evil.example' },
      method: 'POST',
    })
    expect(res.status).toBe(403)
  })
})

describe('auth surface', () => {
  const unused = [
    ['POST', '/sign-in/social'],
    ['POST', '/update-user'],
    ['POST', '/change-email'],
    ['POST', '/verify-password'],
    ['POST', '/set-password'],
    ['GET', '/reset-password/some-token'],
    ['GET', '/delete-user/callback?token=x'],
    ['GET', '/callback/github'],
    ['GET', '/list-accounts'],
    ['POST', '/update-session'],
    ['GET', '/sign-out'],
    ['POST', '/get-session'],
    ['POST', '/sign-in/email/'],
    ['POST', '/list-sessions'],
    ['GET', '/revoke-sessions'],
    ['POST', '/sign-up/email'],
    ['POST', '/send-verification-email'],
    ['GET', '/verify-email?token=x'],
    ['POST', '/request-password-reset'],
    ['POST', '/reset-password'],
    ['POST', '/change-password'],
    ['GET', '/list-sessions'],
    ['POST', '/revoke-session'],
    ['POST', '/revoke-other-sessions'],
    ['POST', '/revoke-sessions'],
    ['POST', '/delete-user'],
  ] as const
  it.each(unused)('%s %s is not exposed', async (method, path) => {
    const res = await fetch(`${appUrl}/api/auth${path}`, {
      body: method === 'POST' ? '{}' : null,
      headers: { 'content-type': 'application/json', origin: appUrl, 'x-forwarded-for': nextIp() },
      method,
    })
    expect(res.status).toBe(404)
  })

  it('exposes the session to its owner through GET /get-session', async () => {
    const res = await fetch(`${appUrl}/api/auth/get-session`, { headers: { cookie, 'x-forwarded-for': nextIp() } })
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toContain('no-store')
    expect((await res.json()) as unknown).toMatchObject({ user: { email } })
  })
})

const postTo = (path: string, body: BodyInit) =>
  fetch(appUrl + path, {
    body,
    duplex: 'half',
    headers: { 'content-type': 'application/json', origin: appUrl },
    method: 'POST',
  } as RequestInit)

describe('requests', () => {
  it('rejects bodies over 64 KiB and bodies without a length', async () => {
    expect((await postTo('/api/me', JSON.stringify({ body: 'x'.repeat(70_000) }))).status).toBe(413)
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"body":"x"}'))
        controller.close()
      },
    })
    expect((await postTo('/api/me', stream)).status).toBe(411)
  })

  it('does not leak internals in error responses', async () => {
    const forged = await fetch(`${appUrl}/api/me`, { headers: { cookie: 'better-auth.session_token=forged.value' } })
    expect(forged.status).toBe(401)
    const unknownFn = await fetch(`${appUrl}/_serverFn/does-not-exist`, {
      body: '{}',
      headers: { 'content-type': 'application/json', origin: appUrl },
      method: 'POST',
    })
    for (const text of [await forged.text(), await unknownFn.text()]) {
      expect(text).not.toMatch(/\bat .+:\d+:\d+|node_modules|\.mjs|select |postgres/i)
    }
  })

  it('answers an unknown server function with an error that leaks nothing', async () => {
    const get = await fetch(`${appUrl}/_serverFn/does-not-exist`)
    const post = await fetch(`${appUrl}/_serverFn/does-not-exist`, {
      body: '{}',
      headers: { 'content-type': 'application/json', origin: appUrl },
      method: 'POST',
    })
    for (const res of [get, post]) {
      expect(res.status).toBeGreaterThanOrEqual(400)
      expect(await res.text()).not.toMatch(/does-not-exist|Server function|\bat .+:\d+:\d+|node_modules|\.mjs/)
    }
  })

  it('does not redirect to other hosts', async () => {
    const targets = await Promise.all(
      ['//evil.example/', String.raw`/\evil.example`].map(async (path) => {
        const location = (await fetch(appUrl + path, { redirect: 'manual' })).headers.get('location')
        return location ? new URL(location, appUrl).origin : new URL(appUrl).origin
      }),
    )
    expect(targets).toEqual([new URL(appUrl).origin, new URL(appUrl).origin])
  })
})

describe('sessions', () => {
  it('answers unknown emails and wrong passwords identically', async () => {
    const ip = nextIp()
    const unknown = await postSignIn(
      { email: `nobody-${crypto.randomUUID()}@example.test`, password: 'wrong-password-123' },
      { 'x-forwarded-for': ip },
    )
    const wrong = await postSignIn({ email, password: 'wrong-password-123' }, { 'x-forwarded-for': ip })
    expect(unknown.status).toBe(401)
    expect(wrong.status).toBe(401)
    expect(await unknown.json()).toEqual(await wrong.json())
  })

  it('limits sign-in to 3 attempts per 10 s per client IP', async () => {
    const client = nextIp()
    const attempts: Array<Response> = []
    for (let attempt = 0; attempt < 4; attempt++) {
      attempts.push(await postSignIn({ email, password: 'wrong-password-123' }, { 'x-forwarded-for': client }))
    }
    expect(attempts.map((res) => res.status)).toEqual([401, 401, 401, 429])
    expect(Number(attempts[3]!.headers.get('x-retry-after'))).toBeLessThanOrEqual(10)

    const forgeries: Array<Record<string, string> & { 'x-forwarded-for': string }> = [
      { 'x-forwarded-for': `203.0.113.7, ${client}` },
      { 'x-forwarded-for': `203.0.113.8, 198.18.0.9, ${client}` },
    ]
    for (const headers of forgeries) {
      expect((await postSignIn({ email, password }, headers)).status, JSON.stringify(headers)).toBe(429)
    }

    const res = await postSignIn({ email, password }, { 'x-forwarded-for': nextIp() })
    expect(res.status).toBe(200)
  })

  it('signs in while the browser still sends a stale session cookie', async () => {
    for (const stale of ['better-auth.session_token=stale.not-a-valid-signature', cookie]) {
      const res = await postSignIn({ email, password }, { cookie: stale, 'x-forwarded-for': nextIp() })
      expect(res.status).toBe(200)
      const next = sessionCookie(res)!
      expect(next).toBeTruthy()
      expect(next).not.toBe(stale)
      expect((await me(next)).status).toBe(200)
    }
  })

  it('ends the session on sign-out', async () => {
    const session = await signIn(sharedUsers.author, nextIp())
    expect((await me(session)).status).toBe(200)
    const out = await fetch(`${appUrl}/api/auth/sign-out`, {
      body: '{}',
      headers: { 'content-type': 'application/json', cookie: session, origin: appUrl, 'x-forwarded-for': nextIp() },
      method: 'POST',
    })
    expect(out.status).toBe(200)
    expect((await me(session)).status).toBe(401)
    expect((await me(cookie)).status).toBe(200)
  })
})
