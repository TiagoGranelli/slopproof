// Rules for the committed openapi.json that need no server, so `pnpm check` catches them right after `pnpm codegen`
// instead of at the end of `verify:app` (tests/integration/api.test.ts checks the app serves this same file).
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { Json } from '#/contract/json.ts'

describe('openapi.json', () => {
  it('documents cookie auth on private operations and 400 only where there is a body or a query', () => {
    type Operation = {
      parameters?: Array<Json>
      requestBody?: Json
      responses: Record<string, Json>
      security?: Array<Record<string, Array<string>>>
    }
    const spec = JSON.parse(readFileSync('openapi.json', 'utf8')) as {
      components: {
        schemas: Record<string, Json>
        securitySchemes?: Record<string, { in?: string; name?: string; type: string }>
      }
      paths: Record<string, Record<string, Operation>>
    }
    const schemes = spec.components.securitySchemes ?? {}
    expect(
      Object.values(schemes)
        .map((s) => `${s.type} ${s.in} ${s.name}`)
        .toSorted(),
    ).toEqual(['apiKey cookie __Secure-better-auth.session_token', 'apiKey cookie better-auth.session_token'])
    // Generated names like Post_1 mean two schemas collided; the SDK types would get unstable names.
    expect(Object.keys(spec.components.schemas).filter((name) => /_\d+$/.test(name))).toEqual([])
    const operations = Object.entries(spec.paths).flatMap(([path, ops]) =>
      Object.entries(ops).map(([method, op]) => ({ id: `${method.toUpperCase()} ${path}`, op, path })),
    )
    expect(operations.length).toBeGreaterThan(0)
    for (const { id, op, path } of operations) {
      const alternatives = (op.security ?? []).flatMap((requirement) => Object.keys(requirement)).toSorted()
      const privatePath = path === '/api/me' || path.startsWith('/api/me/')
      // An operation that needs a session lives under /api/me/ (POST /api/me/posts, not POST /api/posts), so the
      // path alone says who may call it.
      expect(
        alternatives,
        `${id}: a session-only operation belongs under /api/me/, a public one needs no session`,
      ).toEqual(privatePath ? Object.keys(schemes).toSorted() : [])
      // A path id is any string (a malformed one answers like a missing one), so it never makes a 400.
      const query = (op.parameters ?? []).filter((parameter) => (parameter as { in: string }).in === 'query')
      const hasInput = op.requestBody !== undefined || query.length > 0
      expect('400' in op.responses, id).toBe(hasInput)
    }
  })
})
