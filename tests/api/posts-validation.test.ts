import { describe, expect, it, onTestFinished } from '@effect/vitest'
import * as fc from 'fast-check'
import { POST_MAX_LENGTH, POSTS_PAGE_MAX } from '#/contract/limits.ts'
import { webHandler } from './harness.ts'

const APP = 'http://localhost:3000'
const NUL_MESSAGE = 'Remove the invisible NUL character (U+0000) from the text.'

const send = async (method: string, path: string, body?: string) => {
  const { dispose, handler } = webHandler()
  onTestFinished(dispose)
  const response = await handler(
    new Request(`${APP}${path}`, {
      body: body ?? null,
      headers: { 'content-type': 'application/json', cookie: 'better-auth.session_token=alice' },
      method,
    }),
  )
  return { json: (await response.json()) as unknown, status: response.status }
}

describe('payload validation', () => {
  const invalid: Array<[string, string, string]> = [
    ['empty', JSON.stringify({ body: '' }), 'Write something to post.'],
    ['untrimmed', JSON.stringify({ body: ' hi ' }), 'Remove the spaces before and after the text.'],
    [
      'over the limit',
      JSON.stringify({ body: 'x'.repeat(POST_MAX_LENGTH + 1) }),
      `Use at most ${POST_MAX_LENGTH} characters.`,
    ],
    ['NUL-carrying', JSON.stringify({ body: 'before\u0000after' }), NUL_MESSAGE],
    ['not a string', JSON.stringify({ body: 42 }), 'Expected string'],
    ['missing', JSON.stringify({}), 'Missing key'],
  ]

  it.each(invalid)('maps a %s body to ValidationError on create and update', async (_, body, message) => {
    for (const [method, path] of [
      ['POST', '/api/me/posts'],
      ['PATCH', '/api/me/posts/00000000-0000-4000-8000-000000000000'],
    ] as const) {
      const response = await send(method, path, body)
      expect(response, `${method} ${path}`).toEqual({
        json: { _tag: 'ValidationError', issues: [{ message, path: ['body'] }], message: 'Invalid request payload' },
        status: 400,
      })
    }
  })

  it('maps malformed JSON to ValidationError without echoing the input', async () => {
    const response = await send('POST', '/api/me/posts', '{"body": "secret-value')
    expect(response.status).toBe(400)
    expect(response.json).toMatchObject({ _tag: 'ValidationError', message: 'Invalid request payload' })
    expect(JSON.stringify(response.json)).not.toContain('secret-value')
  })

  it('accepts a body of exactly the limit', async () => {
    const response = await send('POST', '/api/me/posts', JSON.stringify({ body: 'x'.repeat(POST_MAX_LENGTH) }))
    expect(response.status).toBe(201)
  })
})

const cursor = (key: unknown) => Buffer.from(JSON.stringify(key)).toString('base64url')

describe('list query validation', () => {
  const valid = { createdAt: '2026-01-01T00:00:01.000000Z', id: '00000000-0000-4000-8000-000000000000' }
  const invalid: Array<[string, string]> = [
    ['a cursor that is not base64url', `cursor=${encodeURIComponent('not base64!')}`],
    ['a cursor that is not JSON', `cursor=${Buffer.from('nope').toString('base64url')}`],
    ['a cursor without an id', `cursor=${cursor({ createdAt: valid.createdAt })}`],
    ['a cursor with a non-UUID id', `cursor=${cursor({ ...valid, id: 'post-1' })}`],
    ['a cursor at millisecond precision', `cursor=${cursor({ ...valid, createdAt: '2026-01-01T00:00:01.000Z' })}`],
    ['a cursor on February 30', `cursor=${cursor({ ...valid, createdAt: '2026-02-30T00:00:00.000000Z' })}`],
    ['a cursor with text after its Z', `cursor=${cursor({ ...valid, createdAt: `${valid.createdAt}junk` })}`],
    ['a limit of 0', 'limit=0'],
    ['a limit over the maximum', `limit=${POSTS_PAGE_MAX + 1}`],
    ['a limit in exponent notation', 'limit=1e1'],
    ['a limit that is not a number', 'limit=ten'],
  ]

  it.each(invalid)('maps %s to ValidationError on both lists', async (_, query) => {
    for (const path of ['/api/posts', '/api/me/posts']) {
      const response = await send('GET', `${path}?${query}`)
      expect(response, `${path}?${query}`).toMatchObject({
        json: { _tag: 'ValidationError', message: 'Invalid request query' },
        status: 400,
      })
      const { issues } = response.json as { issues: Array<{ path: Array<unknown> }> }
      expect(issues.map((issue) => issue.path[0])).toEqual([query.slice(0, query.indexOf('='))])
    }
  })

  it('answers any cursor with a page or a 400, never anything else', async () => {
    const { dispose, handler } = webHandler()
    onTestFinished(dispose)
    const cursors = fc.oneof(
      fc.string(),
      fc.jsonValue().map((value) => cursor(value)),
      fc.record({ createdAt: fc.string(), id: fc.oneof(fc.string(), fc.uuid()) }).map((value) => cursor(value)),
      fc.tuple(fc.string(), fc.uuid()).map(([suffix, id]) => cursor({ createdAt: `${valid.createdAt}${suffix}`, id })),
    )
    await fc.assert(
      fc.asyncProperty(cursors, async (value) => {
        for (const path of ['/api/posts', '/api/me/posts']) {
          const response = await handler(
            new Request(`${APP}${path}?cursor=${encodeURIComponent(value)}`, {
              headers: { cookie: 'better-auth.session_token=alice' },
            }),
          )
          const body = (await response.json()) as { _tag?: string }
          const outcome = response.status === 400 ? `400 ${body._tag}` : String(response.status)
          expect(['200', '400 ValidationError'], `${path} ${JSON.stringify(value)}`).toContain(outcome)
        }
      }),
      { numRuns: 300 },
    )
  })

  it('accepts a well-formed cursor that matches no post, and the largest limit', async () => {
    for (const path of ['/api/posts', '/api/me/posts']) {
      expect(await send('GET', `${path}?cursor=${cursor(valid)}&limit=${POSTS_PAGE_MAX}`)).toEqual({
        json: { items: [], nextCursor: null },
        status: 200,
      })
    }
  })
})
