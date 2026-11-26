import { readFileSync } from 'node:fs'
import { describe, expect, it, onTestFinished } from '@effect/vitest'
import * as fc from 'fast-check'
import type { Json } from '#/contract/json.ts'
import { POST_MAX_LENGTH, POSTS_PAGE_MAX } from '#/contract/limits.ts'
import { webHandler } from './harness.ts'
import { operations, requestFor } from './operations.ts'

const APP = 'http://localhost:3000'
const ALICE_COOKIE = 'better-auth.session_token=alice'
const VALID_UUID = '00000000-0000-4000-8000-000000000000'

type OpenApiSpec = {
  readonly paths: Record<
    string,
    Record<string, { readonly operationId: string; readonly responses: Record<string, Json> }>
  >
}

const declaredStatusesByOperation = (() => {
  const spec = JSON.parse(readFileSync('openapi.json', 'utf8')) as OpenApiSpec
  const byOp = new Map<string, ReadonlySet<number>>()
  for (const methods of Object.values(spec.paths)) {
    for (const operation of Object.values(methods)) {
      byOp.set(operation.operationId, new Set(Object.keys(operation.responses).map(Number)))
    }
  }
  return byOp
})()

const declaredFor = (operationName: string): ReadonlySet<number> => {
  const statuses = declaredStatusesByOperation.get(operationName)
  if (!statuses) {
    throw new Error(`Missing OpenAPI statuses for operation ${operationName}`)
  }
  return statuses
}

const ATTACK_STRINGS = [
  '',
  ' ',
  "' OR 1=1--",
  '"; DROP TABLE post; --',
  '<script>alert(1)</script>',
  '<img src=x onerror=alert(1)>',
  '{{7*7}}',
  'before\u0000after',
  '\u202Ereversed\u202C',
  '__proto__',
  'constructor',
  'x'.repeat(POST_MAX_LENGTH + 5),
]

const attackString = fc.oneof(fc.constantFrom(...ATTACK_STRINGS), fc.string({ maxLength: 64 }))

const corruptCursor = fc.oneof(
  attackString,
  fc.string({ maxLength: 48 }).map((raw) => Buffer.from(raw, 'utf8').toString('base64url')),
  fc
    .record({ createdAt: attackString, id: attackString })
    .map((key) => Buffer.from(JSON.stringify(key)).toString('base64url')),
)

const badLimit = fc.oneof(
  attackString,
  fc.constantFrom('0', '-1', String(POSTS_PAGE_MAX + 1), '999', '1e2', '2.5', ' 10', '１０'),
)

const malformedJsonPayloads = fc.oneof(
  fc.constantFrom('', '{', '}', '[', 'null', 'true', '42', '[]', '{"body":', '{"body":"secret-leak'),
  attackString.map((body) => JSON.stringify({ body })),
  fc
    .tuple(attackString, attackString)
    .map(([body, extra]) => JSON.stringify({ admin: true, body, extra, nested: { polluted: true } })),
  fc
    .oneof(fc.integer(), fc.boolean(), fc.constant(null), fc.array(fc.string({ maxLength: 8 })))
    .map((body) => JSON.stringify({ body })),
  fc.constant('{"body":"hello","__proto__":{"polluted":true}}'),
)

const invalidBrandedIds = fc
  .oneof(
    fc.constantFrom(
      'not-a-uuid',
      "' OR 1=1--",
      '<script>alert(1)</script>',
      'before\u0000after',
      '\u202Euuid\u202C',
      '00000000-0000-4000-8000-00000000000g',
      '12345',
      'x'.repeat(200),
    ),
    fc.string({ maxLength: 48, minLength: 1 }),
  )
  .filter((raw) => raw !== '.' && raw !== '..' && !raw.includes('/') && !raw.includes('\\'))

describe('contract fuzzing against webHandler', () => {
  it('never returns 500 or undeclared statuses for query fuzzing across read endpoints', async () => {
    const { dispose, handler: dispatch } = webHandler()
    onTestFinished(dispose)
    const readTargets = [
      { name: 'system.health', path: '/api/health' },
      { name: 'system.ready', path: '/api/ready' },
      { name: 'me.get', path: '/api/me' },
      { name: 'publicPosts.list', path: '/api/posts' },
      { name: 'myPosts.list', path: '/api/me/posts' },
    ] as const
    await fc.assert(
      fc.asyncProperty(corruptCursor, badLimit, attackString, async (cursor, limit, extra) => {
        const query = new URLSearchParams({ cursor, extra, limit }).toString()
        for (const target of readTargets) {
          const response = await dispatch(
            new Request(`${APP}${target.path}?${query}`, { headers: { cookie: ALICE_COOKIE } }),
          )
          expect(response.status, `${target.name}?${query}`).not.toBe(500)
          expect(declaredFor(target.name).has(response.status), `${target.name} -> ${response.status}`).toBe(true)
        }
      }),
      { numRuns: 60 },
    )
  })

  it('never returns 500 or leaks input on random/malformed JSON, SQLi/XSS, and extra fields', async () => {
    const { dispose, handler: dispatch } = webHandler()
    onTestFinished(dispose)
    const createDeclared = declaredFor('myPosts.create')
    const updateDeclared = declaredFor('myPosts.update')
    await fc.assert(
      fc.asyncProperty(malformedJsonPayloads, async (payload) => {
        const headers = { 'content-type': 'application/json', cookie: ALICE_COOKIE }
        const created = await dispatch(new Request(`${APP}/api/me/posts`, { body: payload, headers, method: 'POST' }))
        const updated = await dispatch(
          new Request(`${APP}/api/me/posts/${VALID_UUID}`, { body: payload, headers, method: 'PATCH' }),
        )
        expect(created.status).not.toBe(500)
        expect(updated.status).not.toBe(500)
        expect(createDeclared.has(created.status)).toBe(true)
        expect(updateDeclared.has(updated.status)).toBe(true)
        expect(Object.prototype).not.toHaveProperty('polluted')
      }),
      { numRuns: 50 },
    )
  })

  it('never returns 500 on invalid branded IDs for PATCH and DELETE', async () => {
    const { dispose, handler: dispatch } = webHandler()
    onTestFinished(dispose)
    const updateDeclared = declaredFor('myPosts.update')
    const removeDeclared = declaredFor('myPosts.remove')
    await fc.assert(
      fc.asyncProperty(invalidBrandedIds, async (rawId) => {
        const encodedId = encodeURIComponent(rawId)
        const headers = { 'content-type': 'application/json', cookie: ALICE_COOKIE }
        const patched = await dispatch(
          new Request(`${APP}/api/me/posts/${encodedId}`, {
            body: JSON.stringify({ body: 'valid edit' }),
            headers,
            method: 'PATCH',
          }),
        )
        const removed = await dispatch(
          new Request(`${APP}/api/me/posts/${encodedId}`, { headers: { cookie: ALICE_COOKIE }, method: 'DELETE' }),
        )
        expect(patched.status).not.toBe(500)
        expect(removed.status).not.toBe(500)
        expect(updateDeclared.has(patched.status), `PATCH ${encodedId} -> ${patched.status}`).toBe(true)
        expect(removeDeclared.has(removed.status), `DELETE ${encodedId} -> ${removed.status}`).toBe(true)
      }),
      { numRuns: 50 },
    )
  })

  it('answers only OpenAPI-declared statuses for adversarial cookies across every operation', async () => {
    const { dispose, handler: dispatch } = webHandler()
    onTestFinished(dispose)
    const cookies = fc.oneof(
      fc.constant(''),
      fc
        .constantFrom('alice', 'bob', 'forged', '', "' OR 1=1--", '<script>')
        .map((token) => `better-auth.session_token=${token}`),
      fc.stringMatching(/^[A-Za-z0-9_=.-]{0,40}$/).map((token) => `__Secure-better-auth.session_token=${token}`),
    )
    await fc.assert(
      fc.asyncProperty(cookies, async (cookie) => {
        for (const operation of operations) {
          const response = await dispatch(requestFor(operation, cookie ? { cookie } : {}))
          expect(response.status, `${operation.name} (${cookie})`).not.toBe(500)
          expect(declaredFor(operation.name).has(response.status), `${operation.name} -> ${response.status}`).toBe(true)
        }
      }),
      { numRuns: 25 },
    )
  })
})
