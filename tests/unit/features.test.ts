import { describe, expect, it } from 'vitest'
import { checkFeatures, featuresForPath, loadFeatures } from '../../scripts/features.ts'
import type { Feature } from '../../scripts/features.ts'

const sampleFeature = (overrides: Partial<Feature> = {}): Feature => ({
  apiOperations: [],
  id: 'sample',
  paths: ['src/contract/system.ts'],
  purpose: 'Sample feature.',
  routes: [],
  tests: ['tests/unit/features.test.ts'],
  verify: 'pnpm test:unit features',
  ...overrides,
})

describe('featuresForPath', () => {
  it('matches exact files, leading ./ and directory queries', () => {
    const features = [sampleFeature({ id: 'posts', paths: ['src/features/posts/api/create-post.ts'] })]
    expect(featuresForPath('./src/features/posts/api/create-post.ts', features).map((entry) => entry.id)).toEqual([
      'posts',
    ])
    expect(featuresForPath('src/features/posts', features).map((entry) => entry.id)).toEqual(['posts'])
    expect(featuresForPath('src/routes/about.tsx', features)).toEqual([])
  })

  it('matches files inside a feature-owned directory', () => {
    const features = [sampleFeature({ id: 'auth', paths: ['src/features/auth'] })]
    expect(featuresForPath('src/features/auth/api/sign-in.ts', features).map((entry) => entry.id)).toEqual(['auth'])
  })
})

describe('checkFeatures', () => {
  it('reports duplicate ids, missing paths/tests, and OpenAPI drift', () => {
    const features = [
      sampleFeature({
        apiOperations: ['ghost.op'],
        id: 'dup',
        paths: ['src/does-not-exist.ts'],
        tests: ['tests/does-not-exist.test.ts'],
      }),
      sampleFeature({ id: 'dup' }),
    ]
    const problems = checkFeatures({ features, openapiOperations: ['system.health'], roots: [] })
    expect(problems).toEqual([
      'duplicate feature id "dup"',
      'dup: path does not exist: src/does-not-exist.ts',
      'dup: test does not exist: tests/does-not-exist.test.ts',
      'unmapped OpenAPI operation: system.health (add it to docs/agents/features.json)',
      'dup: unknown OpenAPI operation "ghost.op"',
    ])
  })

  it('reports unowned source files under the checked roots', () => {
    const problems = checkFeatures({ features: [], openapiOperations: [], roots: ['src/contract'] })
    expect(problems).toContain('unowned source file: src/contract/api.ts (add it to docs/agents/features.json)')
  })
})

describe('the repository', () => {
  it('maps every owned source file, path, test and OpenAPI operation', () => {
    expect(loadFeatures().length).toBeGreaterThan(0)
    expect(checkFeatures()).toEqual([])
  })
})
