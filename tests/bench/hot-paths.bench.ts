import { Schema } from 'effect'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PageCursor } from '#/contract/pages.ts'
import { safeRedirect } from '#/features/auth/utils/safe-redirect.ts'
import { INITIAL_POST_EDITOR_STATE, transitionPostEditor } from '#/features/posts/utils/post-editor-machine.ts'
import { documentHeaders, nonceSources } from '#/lib/content-security-policy.ts'
import { displayClientAddress } from '#/server/http/client-address.ts'
import { forwardedFor } from '#/server/http/forwarded-for.ts'

const encodeCursor = Schema.encodeSync(PageCursor)
const decodeCursor = Schema.decodeUnknownSync(PageCursor)
const runForwardedFor = forwardedFor
const runDisplayClientAddress = displayClientAddress
const runSafeRedirect = safeRedirect
const runDocumentHeaders = documentHeaders
const runNonceSources = nonceSources
const runTransitionPostEditor = transitionPostEditor
const initialEditorState = INITIAL_POST_EDITOR_STATE

const sampleKey: PageCursor = {
  createdAt: '2026-10-15T12:34:56.123456Z',
  id: '0195f1b2-3c4d-7e8f-9a0b-1c2d3e4f5a6b',
}
const encodedSample = encodeCursor(sampleKey)
const editorSession = Symbol('bench-editor')

const ensureBenchEnv = () => {
  process.env.APP_URL ??= 'http://localhost:3000'
  process.env.BETTER_AUTH_SECRET ??= 'bench-tests-only-not-a-secret-0000000000'
  process.env.DATABASE_URL ??= 'postgres://unused:unused@127.0.0.1:9/unused'
  process.env.NODE_ENV ??= 'test'
  process.env.TRUSTED_PROXIES ??= ''
}

const runEditorLifecycle = () => {
  let state = initialEditorState
  state = runTransitionPostEditor(state, {
    canEdit: true,
    savedBody: 'Initial post body',
    session: editorSession,
    type: 'OPEN',
  })
  state = runTransitionPostEditor(state, { draft: 'Updated post body', type: 'DRAFT_CHANGED' })
  state = runTransitionPostEditor(state, { type: 'SUBMIT' })
  state = runTransitionPostEditor(state, {
    body: 'Updated post body',
    session: editorSession,
    type: 'SAVE_SUCCEEDED',
  })
  return runTransitionPostEditor(state, { type: 'FOCUS_RETURNED' })
}

describe('hot-path benchmarks', () => {
  let dispatch: (request: Request) => Promise<Response>
  let dispose: () => Promise<void>

  beforeAll(async () => {
    ensureBenchEnv()
    const { webHandler } = await import('../api/harness.ts')
    const server = webHandler()
    dispatch = server.handler
    dispose = server.dispose
    for (let index = 0; index < 20; index += 1) {
      await dispatch(
        new Request('http://localhost:3000/api/me/posts', {
          body: JSON.stringify({ body: `Benchmark post ${index}` }),
          headers: { 'content-type': 'application/json', cookie: 'better-auth.session_token=alice' },
          method: 'POST',
        }),
      )
    }
  })

  afterAll(async () => {
    await dispose()
  })

  it('benchmarks keyset cursor encode and decode', async ({ bench }) => {
    const encoded = await bench('encode PageCursor', () => {
      encodeCursor(sampleKey)
    }).run()
    const decoded = await bench('decode PageCursor', () => {
      decodeCursor(encodedSample)
    }).run()
    expect(encoded.throughput.mean).toBeGreaterThan(0)
    expect(decoded.throughput.mean).toBeGreaterThan(0)
  })

  it('benchmarks forwardedFor and displayClientAddress', async ({ bench }) => {
    const forwarded = await bench('forwardedFor trusted chain', () => {
      runForwardedFor('203.0.113.9, 10.0.0.1', '10.0.0.2', true)
    }).run()
    const address = await bench('displayClientAddress IPv6 /64', () => {
      runDisplayClientAddress('2001:0db8:0001:0002:0000:0000:0000:0000')
    }).run()
    expect(forwarded.throughput.mean).toBeGreaterThan(0)
    expect(address.throughput.mean).toBeGreaterThan(0)
  })

  it('benchmarks safeRedirect accept and reject paths', async ({ bench }) => {
    const accepted = await bench('safeRedirect valid path', () => {
      runSafeRedirect('/dashboard?tab=posts#latest')
    }).run()
    const rejected = await bench('safeRedirect reject protocol-relative', () => {
      runSafeRedirect('/%2f%2fevil.example/phish')
    }).run()
    expect(accepted.throughput.mean).toBeGreaterThan(0)
    expect(rejected.throughput.mean).toBeGreaterThan(0)
  })

  it('benchmarks CSP header generation', async ({ bench }) => {
    const policy = await bench('documentHeaders with nonceSources', () => {
      runDocumentHeaders(runNonceSources('r4nd0mN0nceValue1234567890'))
    }).run()
    expect(policy.throughput.mean).toBeGreaterThan(0)
  })

  it('benchmarks post-editor-machine reducer lifecycle', async ({ bench }) => {
    const lifecycle = await bench('post-editor-machine lifecycle', () => {
      runEditorLifecycle()
    }).run()
    expect(lifecycle.throughput.mean).toBeGreaterThan(0)
  })

  it('benchmarks in-process GET /api/posts', async ({ bench }) => {
    const apiPosts = await bench('GET /api/posts?limit=20', async () => {
      await dispatch(new Request('http://localhost:3000/api/posts?limit=20'))
    }).run()
    expect(apiPosts.throughput.mean).toBeGreaterThan(0)
  })
})
