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
    expect(Object.keys(spec.components.schemas).filter((name) => /_\d+$/.test(name))).toEqual([])
    const operations = Object.entries(spec.paths).flatMap(([path, ops]) =>
      Object.entries(ops).map(([method, op]) => ({ id: `${method.toUpperCase()} ${path}`, op, path })),
    )
    expect(operations.length).toBeGreaterThan(0)
    for (const { id, op, path } of operations) {
      const alternatives = (op.security ?? []).flatMap((requirement) => Object.keys(requirement)).toSorted()
      const privatePath = path === '/api/me' || path.startsWith('/api/me/')
      expect(
        alternatives,
        `${id}: a session-only operation belongs under /api/me/, a public one needs no session`,
      ).toEqual(privatePath ? Object.keys(schemes).toSorted() : [])
      const query = (op.parameters ?? []).filter((parameter) => (parameter as { in: string }).in === 'query')
      const hasInput = op.requestBody !== undefined || query.length > 0
      expect('400' in op.responses, id).toBe(hasInput)
    }
  })
})
