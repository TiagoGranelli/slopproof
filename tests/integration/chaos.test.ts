import { readFileSync } from 'node:fs'
import { Client, Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { LOOPBACK, startApp } from '../../scripts/app-server.ts'
import type { RunningApp } from '../../scripts/app-server.ts'
import { dropTestDatabase, openConnections, testDatabaseUrl } from '../../scripts/test-db.ts'
import { clientIps, sessionCookie } from './helpers.ts'
import { callAuthFunction } from './server-functions.ts'

const LOG_FILE = 'test-results/app-server-chaos.log'
const MAX_SHUTDOWN_MS = 5000
const nextIp = clientIps('198.51.200')

let app: RunningApp
let databaseUrl: string
let cookie: string
let tokenPrefix: string
const piiSamples: Array<string> = []

const signInTo = async (target: RunningApp) => {
  const res = await fetch(`${target.url}/api/auth/sign-in/email`, {
    body: JSON.stringify({ email: target.user.email, password: target.user.password }),
    headers: { 'content-type': 'application/json', origin: target.url, 'x-forwarded-for': nextIp() },
    method: 'POST',
  })
  expect(res.status).toBe(200)
  const found = sessionCookie(res)
  expect(found).toBeTruthy()
  return found!
}

const terminateAppBackends = async (url: string) => {
  const admin = new Client({ application_name: 'chaos-admin', connectionString: url })
  await admin.connect()
  try {
    const query = await admin.query<{ terminated: boolean }>(
      `select pg_terminate_backend(pid) as terminated from pg_stat_activity
        where datname = current_database() and application_name = 'app' and pid <> pg_backend_pid()`,
    )
    return query.rows.filter((row) => row.terminated).length
  } finally {
    await admin.end()
  }
}

const expectNoPii = (text: string, label: string) => {
  for (const secret of piiSamples) {
    expect(text.includes(secret), `${label} leaked sensitive value`).toBe(false)
  }
}

const pauseMs = (ms: number) =>
  new Promise((resolve) => {
    // Wait briefly so lock contention overlaps the concurrent HTTP request in flight.
    // oxlint-disable-next-line eslint-js/no-restricted-syntax
    setTimeout(resolve, ms)
  })

describe('chaos and fault injection', () => {
  beforeAll(async () => {
    databaseUrl = testDatabaseUrl('chaos')
    app = await startApp({
      databaseUrl,
      logFile: LOG_FILE,
      settings: { AUTH_SIGN_UP: 'open', MAIL_FROM: 'App <no-reply@example.test>', SMTP_URL: 'smtp://127.0.0.1:1' },
      trustedProxies: LOOPBACK,
    })
    cookie = await signInTo(app)
    tokenPrefix = decodeURIComponent(cookie.split('=')[1]!).split('.')[0]!
    piiSamples.push(app.user.email, app.user.password, app.otherUser.email, tokenPrefix)
  }, 60_000)

  afterAll(async () => {
    await (app as RunningApp | undefined)?.stop()
    if (databaseUrl) {
      await dropTestDatabase(databaseUrl)
    }
  })

  it('recovers its Postgres pool after active backends are terminated mid-flight', async () => {
    expect((await fetch(`${app.url}/api/ready`)).status).toBe(200)
    const burst = Promise.all(Array.from({ length: 6 }, () => fetch(`${app.url}/api/posts`)))
    const terminated = await terminateAppBackends(databaseUrl)
    await burst
    expect(terminated).toBeGreaterThanOrEqual(1)
    expect((await fetch(`${app.url}/api/ready`)).status).toBe(200)
    expect((await fetch(`${app.url}/api/posts`)).status).toBe(200)
    expect((await fetch(`${app.url}/api/me`, { headers: { cookie } })).status).toBe(200)
  })

  it('recovers from Postgres statement_timeout and brief table lock contention', async () => {
    const shortPool = new Pool({ connectionString: databaseUrl, max: 2, statement_timeout: 120 })
    try {
      await expect(shortPool.query('select pg_sleep(1)')).rejects.toMatchObject({ code: '57014' })
      const recovered = await shortPool.query<{ ok: number }>('select 1 as ok')
      expect(recovered.rows).toEqual([{ ok: 1 }])
    } finally {
      await shortPool.end()
    }
    const locker = new Client({ application_name: 'chaos-locker', connectionString: databaseUrl })
    await locker.connect()
    try {
      await locker.query('begin; lock table "post" in access exclusive mode')
      const pending = fetch(`${app.url}/api/posts`)
      await pauseMs(120)
      await locker.query('rollback')
      expect((await pending).status).toBe(200)
    } finally {
      await locker.end()
    }
  })

  it('handles unreachable SMTP during sign-up and reset in the background without crashing', async () => {
    const newcomer = {
      email: `chaos-${crypto.randomUUID()}@example.test`,
      name: 'Chaos User',
      password: `pw-${crypto.randomUUID()}`,
    }
    piiSamples.push(newcomer.email, newcomer.password)
    const signUp = await callAuthFunction('signUp', {
      baseUrl: app.url,
      data: newcomer,
      headers: { origin: app.url, 'x-forwarded-for': nextIp() },
    })
    const reset = await callAuthFunction('requestPasswordReset', {
      baseUrl: app.url,
      data: { email: app.user.email },
      headers: { origin: app.url, 'x-forwarded-for': nextIp() },
    })
    expect(signUp.value).toEqual({ ok: true, value: null })
    expect(reset.value).toEqual({ ok: true, value: null })
    expect((await fetch(`${app.url}/api/ready`)).status).toBe(200)
    await expect.poll(() => readFileSync(LOG_FILE, 'utf8'), { timeout: 5000 }).toContain('"background task failed"')
  })

  it('drains concurrent in-flight requests on SIGTERM with zero unhandled rejections and zero PII', async () => {
    const inFlight = Array.from({ length: 8 }, (_, idx) =>
      fetch(`${app.url}${idx % 2 === 0 ? '/api/posts' : '/api/me'}`, { headers: { cookie } }).catch(() => undefined),
    )
    const stopped = await app.stop()
    const responses = (await Promise.all(inFlight)).filter((res): res is Response => res !== undefined)
    for (const res of responses) {
      expect(res.status).toBeLessThan(500)
      expectNoPii(await res.text(), `drain response ${res.url}`)
    }
    expect(stopped).toMatchObject({ code: 0, signal: null })
    expect(stopped.ms).toBeLessThanOrEqual(MAX_SHUTDOWN_MS)
    const log = readFileSync(LOG_FILE, 'utf8')
    expect(log).toContain('"msg":"draining"')
    expect(log).toContain('"msg":"shutdown complete"')
    expect(log).not.toMatch(/unhandledRejection|uncaughtException|Cannot use a pool after calling end/)
    expectNoPii(log, 'server log')
    await expect.poll(() => openConnections(databaseUrl), { timeout: 2000 }).toEqual([])
  })
})
