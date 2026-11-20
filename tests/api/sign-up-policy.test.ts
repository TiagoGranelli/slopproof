import { describe, expect, it } from 'vitest'
import { auth } from '#/server/auth.ts'
import { env } from '#/server/env.ts'

const signUp = (path: string) =>
  auth.handler(
    new Request(`${env.appUrl}/api/auth${path}`, {
      body: JSON.stringify({ email: 'nobody@example.test', name: 'Nobody', password: 'a-long-enough-password' }),
      headers: { 'content-type': 'application/json', origin: env.appUrl },
      method: 'POST',
    }),
  )

describe('closed sign-up (the default)', () => {
  it('is the policy when AUTH_SIGN_UP is unset', () => {
    expect(env.authSignUp).toBe('closed')
  })

  it('answers 404 to a sign-up through Better Auth, before any account is created', async () => {
    expect((await signUp('/sign-up/email')).status).toBe(404)
  })

  it('leaves no other way to sign up by path variants', async () => {
    for (const path of ['/sign-up/email/', '/sign-up//email', '/SIGN-UP/EMAIL', '/sign-up']) {
      expect((await signUp(path)).status, path).toBe(404)
    }
  })
})
