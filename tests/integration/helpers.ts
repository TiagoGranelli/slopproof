import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { inject } from 'vitest'
import { createClient } from '#/sdk/client/index.ts'

const servers = inject('servers')

export const appUrl = servers.appUrl
export const closedAppUrl = servers.closedAppUrl
export const databaseUrl = servers.databaseUrl

export const sharedUsers = { author: servers.user, other: servers.otherUser }

export const clientIps = (prefix: string) => {
  let last = 0
  return () => `${prefix}.${++last}`
}

const SESSION_COOKIE = /^(__Secure-)?better-auth\.session_token=/

export const sessionCookie = (res: Response) =>
  res.headers
    .getSetCookie()
    .map((c) => c.split(';')[0]!)
    .findLast((c) => SESSION_COOKIE.test(c) && !c.endsWith('='))

export const postSignIn = (
  credentials: { email: string; password: string },
  headers: Record<string, string> & { 'x-forwarded-for': string },
) =>
  fetch(`${appUrl}/api/auth/sign-in/email`, {
    body: JSON.stringify({ email: credentials.email, password: credentials.password }),
    headers: { 'content-type': 'application/json', origin: appUrl, ...headers },
    method: 'POST',
  })

export const signIn = async (credentials: { email: string; password: string }, ip: string) => {
  const res = await postSignIn(credentials, { 'x-forwarded-for': ip })
  if (res.status !== 200) {
    throw new Error(`sign-in as ${credentials.email} failed: ${res.status} ${await res.text()}`)
  }
  const cookie = sessionCookie(res)
  if (!cookie) {
    throw new Error(`sign-in as ${credentials.email} set no session cookie`)
  }
  return cookie
}

export const sdkClient = (cookie?: string) =>
  createClient({ baseUrl: appUrl, headers: cookie ? { cookie, origin: appUrl } : {} })

const CREATE_USER = fileURLToPath(new URL('../../scripts/create-user.ts', import.meta.url))

export const createUser = async (label: string) => {
  const account = {
    email: `${label}-${crypto.randomUUID()}@example.test`,
    name: `Integration ${label}`,
    password: `pw-${crypto.randomUUID()}`,
  }
  await promisify(execFile)(process.execPath, [CREATE_USER, account.email, account.name], {
    env: { ...process.env, CREATE_USER_PASSWORD: account.password },
  })
  return account
}
