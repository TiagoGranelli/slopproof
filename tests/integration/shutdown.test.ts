import { readFileSync } from 'node:fs'
import { connect } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { LOOPBACK, type RunningApp, startApp } from '../../scripts/app-server.ts'
import { dropTestDatabase, openConnections, testDatabaseUrl } from '../../scripts/test-db.ts'

const LOG_FILE = 'test-results/app-server-shutdown.log'
const MAX_SHUTDOWN_MS = 3000

const settle = () =>
  // Server gives no observable signal for mid-flight header reads, so a brief fixed wait is required.
  // oxlint-disable-next-line eslint-js/no-restricted-syntax
  new Promise((resolve) => setTimeout(resolve, 20))
const logLines = () => readFileSync(LOG_FILE, 'utf8').split('\n')

const rawConnection = async (directUrl: string) => {
  const socket = connect(Number(new URL(directUrl).port), '127.0.0.1')
  await new Promise((resolve, reject) => socket.once('connect', resolve).once('error', reject))
  let received = ''
  socket.on('data', (chunk: Buffer) => (received += chunk.toString()))
  const closed = new Promise<string>((resolve) => socket.once('close', () => resolve(received)))
  socket.on('error', () => {})
  return { closed, socket }
}

const abandonSignIn = async (app: RunningApp) => {
  const connection = await rawConnection(app.directUrl)
  const body = JSON.stringify({ email: app.user.email, password: app.user.password })
  const request = [
    'POST /api/auth/sign-in/email HTTP/1.1',
    'Host: localhost',
    `Origin: ${app.url}`,
    'Content-Type: application/json',
    `Content-Length: ${Buffer.byteLength(body)}`,
    'X-Forwarded-For: 198.51.100.99',
    '',
    body,
  ]
  connection.socket.write(request.join('\r\n'))
  await settle()
  connection.socket.destroy()
}

const expectSignInFinishedBeforePoolClosed = () => {
  const log = logLines()
  const complete = log.findIndex((line) => line.includes('"shutdown complete"'))
  const signIn = log.findIndex((line) => line.includes('"/api/auth/sign-in/email"') && line.includes('"aborted":true'))
  expect(signIn, 'the abandoned sign-in is logged (499, aborted) before "shutdown complete"').not.toBe(-1)
  expect(signIn).toBeLessThan(complete)
  expect(log[complete], '"shutdown complete" lists the pool').toContain('postgres-pool')
  expect(log.filter((line) => /Failed query|Cannot use a pool after calling end/.test(line))).toEqual([])
}

let app: RunningApp
const databaseUrl = testDatabaseUrl('shutdown')

beforeAll(async () => {
  app = await startApp({ databaseUrl, logFile: LOG_FILE, trustedProxies: LOOPBACK })
  expect((await fetch(new URL('/login', app.directUrl))).status).toBe(200)
}, 60_000)

afterAll(async () => {
  await (app as RunningApp | undefined)?.stop()
  await dropTestDatabase(databaseUrl)
})

describe('shutdown', () => {
  it("runs the server under Node's permission model, as the image does", () => {
    expect(readFileSync(LOG_FILE, 'utf8')).toContain('"permissionModel":true')
  })

  it('drains in-flight work, then closes the pool and exits 0', async () => {
    const ready = await rawConnection(app.directUrl)
    ready.socket.write('GET /api/ready HTTP/1.1\r\nHost: localhost\r\n')
    await abandonSignIn(app)
    const stopping = app.stop()
    await expect.poll(() => readFileSync(LOG_FILE, 'utf8'), { timeout: 10_000 }).toContain('"msg":"draining"')
    ready.socket.write('\r\n')
    const [response, stopped] = await Promise.all([ready.closed, stopping])

    expect(response.split('\r\n', 1)[0], '/api/ready during the drain').toMatch(/^HTTP\/1\.1 503 /)
    expect(response, '/api/ready during the drain closes its connection').toMatch(/^connection: close\r$/im)
    expectSignInFinishedBeforePoolClosed()
    expect(stopped).toMatchObject({ code: 0, signal: null })
    expect(stopped.ms).toBeLessThanOrEqual(MAX_SHUTDOWN_MS)
    await expect.poll(() => openConnections(databaseUrl), { timeout: 1000 }).toEqual([])
  })
})
