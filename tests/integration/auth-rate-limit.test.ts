import { Pool } from 'pg'
import { afterAll, describe, expect, it } from 'vitest'
import { appUrl, databaseUrl, clientIps, postSignIn, sharedUsers } from './helpers.ts'

const nextIp = clientIps('100.64.2')
const pool = new Pool({ connectionString: databaseUrl })
afterAll(() => pool.end())

const counters = async (ip: string) =>
  (
    await pool.query<{ count: number; key: string }>(
      'select key, count from rate_limit where key like $1 order by key',
      [`${ip}|%`],
    )
  ).rows

describe('auth rate limit', () => {
  it('admits exactly the limit when attempts race (atomic increments in Postgres)', async () => {
    const ip = nextIp()
    const attempts = await Promise.all(
      Array.from({ length: 10 }, () =>
        postSignIn({ email: sharedUsers.author.email, password: 'wrong-password-123' }, { 'x-forwarded-for': ip }),
      ),
    )
    const statuses = attempts.map((res) => res.status).toSorted((a, b) => a - b)
    expect(statuses).toEqual([401, 401, 401, 429, 429, 429, 429, 429, 429, 429])
    expect(await counters(ip)).toEqual([{ count: 10, key: `${ip}|/sign-in/email` }])
  })

  it('does not count /get-session', async () => {
    const ip = nextIp()
    const statuses = await Promise.all(
      Array.from({ length: 110 }, async () => {
        const res = await fetch(`${appUrl}/api/auth/get-session`, { headers: { 'x-forwarded-for': ip } })
        return res.status
      }),
    )
    expect(new Set(statuses)).toEqual(new Set([200]))
    expect(await counters(ip)).toEqual([])
  })

  it('does not count, or store, requests for endpoints the app does not expose', async () => {
    const ip = nextIp()
    for (const path of ['/update-user', `/invented-${crypto.randomUUID()}`]) {
      const res = await fetch(`${appUrl}/api/auth${path}`, {
        body: '{}',
        headers: { 'content-type': 'application/json', origin: appUrl, 'x-forwarded-for': ip },
        method: 'POST',
      })
      expect(res.status, path).toBe(404)
    }
    expect(await counters(ip)).toEqual([])
  })
})
