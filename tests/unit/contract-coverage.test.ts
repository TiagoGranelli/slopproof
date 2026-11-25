import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  ALLOWLIST,
  contractCoverageProblems,
  logObservations,
  operations,
  undeclaredStatusProblems,
} from '../../scripts/contract-coverage.ts'

const spec = {
  paths: {
    '/api/me/posts/{id}': { delete: { responses: { '204': {} } }, patch: { responses: { '200': {}, '404': {} } } },
  },
}
const ops = operations(spec)
const none = { undeclared: [], unobserved: [] }
const seen = (method: string, path: string, status: number) => ({ method, path, status })

describe('contractCoverageProblems', () => {
  it('passes when every declared status was seen, on any concrete path of the operation', () => {
    const observed = [
      seen('PATCH', '/api/me/posts/1', 200),
      seen('PATCH', '/api/me/posts/not-a-uuid', 404),
      seen('DELETE', '/api/me/posts/2', 204),
      seen('GET', '/api/me/posts/2', 405),
      seen('PATCH', '/api/me/posts/1/extra', 404),
    ]
    expect(contractCoverageProblems(ops, observed, none)).toEqual([])
  })

  it('names each declared status nobody saw and each undeclared one somebody saw', () => {
    const observed = [seen('PATCH', '/api/me/posts/1', 200), seen('DELETE', '/api/me/posts/1', 403)]
    expect(contractCoverageProblems(ops, observed, none)).toEqual([
      'DELETE /api/me/posts/{id} declares 204, but no test saw it answered',
      'DELETE /api/me/posts/{id} answered 403, which openapi.json does not declare',
      'PATCH /api/me/posts/{id} declares 404, but no test saw it answered',
    ])
  })

  it('accepts allowlisted gaps with a reason, for one operation or all, and rejects stale or unexplained ones', () => {
    const observed = [seen('PATCH', '/api/me/posts/1', 200), seen('DELETE', '/api/me/posts/1', 403)]
    const allowlist = {
      undeclared: [
        { operation: '*', reason: 'CSRF', status: 403 },
        { operation: '*', reason: 'never seen', status: 500 },
      ],
      unobserved: [
        { operation: 'PATCH /api/me/posts/{id}', reason: 'why', status: 404 },
        { operation: 'DELETE /api/me/posts/{id}', reason: ' ', status: 204 },
      ],
    }
    expect(contractCoverageProblems(ops, observed, allowlist)).toEqual([
      `${ALLOWLIST}: DELETE /api/me/posts/{id} 204 needs a reason`,
      `${ALLOWLIST}: * 500 matches no gap any more; remove it`,
    ])
  })
})

describe('logObservations', () => {
  it('reads request lines of the app log and skips everything else, aborted requests included', () => {
    const log = [
      'Listening on http://localhost:3000',
      '{"time":"t","level":"info","msg":"request","method":"GET","path":"/api/posts","status":200,"ms":3}',
      '{"time":"t","level":"error","msg":"api defect","method":"GET","path":"/api/posts"}',
      '{"time":"t","level":"error","msg":"request","method":"GET","path":"/api/posts","status":500}',
      '{"time":"t","level":"info","msg":"request","method":"GET","path":"/api/posts","status":499,"aborted":true}',
      '{not json',
    ].join('\n')
    expect(logObservations(log)).toEqual([seen('GET', '/api/posts', 200), seen('GET', '/api/posts', 500)])
  })
})

describe('undeclaredStatusProblems', () => {
  it('passes when observed statuses are declared or allowlisted without failing on unobserved statuses', () => {
    const observed = [seen('PATCH', '/api/me/posts/1', 200), seen('DELETE', '/api/me/posts/1', 403)]
    const allowlist = {
      undeclared: [{ operation: '*', reason: 'CSRF', status: 403 }],
      unobserved: [],
    }
    expect(undeclaredStatusProblems(ops, observed, allowlist)).toEqual([])
  })

  it('reports unexcused undeclared statuses and unexplained allowlist entries', () => {
    const observed = [seen('PATCH', '/api/me/posts/1', 418), seen('DELETE', '/api/me/posts/1', 403)]
    const allowlist = {
      undeclared: [{ operation: '*', reason: ' ', status: 403 }],
      unobserved: [],
    }
    expect(undeclaredStatusProblems(ops, observed, allowlist)).toEqual([
      `${ALLOWLIST}: * 403 needs a reason`,
      'PATCH /api/me/posts/{id} answered 418, which openapi.json does not declare',
    ])
  })
})

describe('the committed allowlist', () => {
  it('gives every entry a reason', () => {
    const allowlist = JSON.parse(readFileSync(ALLOWLIST, 'utf8')) as Record<string, Array<{ reason: string }>>
    for (const entry of Object.values(allowlist).flat()) {
      expect(entry.reason.trim().length).toBeGreaterThan(20)
    }
  })
})
