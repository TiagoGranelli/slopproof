import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  findRelatedTests,
  generateMutants,
  parseArgs,
  parseCoverageGate,
  scoreMutants,
  thresholdForFile,
} from '../../scripts/mutate.ts'

describe('parseCoverageGate', () => {
  it('extracts every module listed in vitest.config.ts COVERAGE_GATE', () => {
    const gate = parseCoverageGate(readFileSync('vitest.config.ts', 'utf8'))
    expect(gate).toContain('src/features/auth/utils/safe-redirect.ts')
    expect(gate).toContain('src/server/http/forwarded-for.ts')
    expect(gate.length).toBeGreaterThanOrEqual(10)
  })
})

describe('thresholdForFile', () => {
  const gate = [
    'src/server/http/forwarded-for.ts',
    'src/features/auth/utils/safe-redirect.ts',
    'src/features/auth/utils/describe-session.ts',
  ]

  it('applies the 100 / 90 / 80 targets from docs/stack.md', () => {
    expect(thresholdForFile('src/server/http/forwarded-for.ts', gate)).toBe(100)
    expect(thresholdForFile('src/features/auth/utils/safe-redirect.ts', gate)).toBe(90)
    expect(thresholdForFile('src/features/auth/utils/describe-session.ts', gate)).toBe(90)
    expect(thresholdForFile('src/features/posts/components/post-list.tsx', gate)).toBe(80)
    expect(thresholdForFile('src/components/errors/api-error-alert.tsx', gate)).toBe(80)
  })
})

describe('generateMutants', () => {
  it('mutates equality, logical, relational, boolean, optional-chain, and negation operators', () => {
    const sample = [
      "import type { Foo } from './bar.ts'",
      'export const check = (input: string | null, limit: number) => {',
      "  if (!input || input.length > limit || input === 'skip') {",
      '    return false',
      '  }',
      '  return Boolean(input?.trim()) && true',
      '}',
    ].join('\n')
    const mutants = generateMutants('sample.ts', sample)
    const operators = new Set(mutants.map((entry) => entry.operator))
    expect(operators).toEqual(
      new Set(['boolean', 'equality', 'logical', 'optional-chain', 'relational', 'unary-negate']),
    )
    expect(mutants.every((entry) => entry.line >= 3)).toBe(true)
  })

  it('skips string literals, import statements, and type generics', () => {
    const sample = [
      "import { readFileSync } from 'node:fs'",
      'type Box = Array<string>',
      "export const label = (): Box => ['a === b && !c || true']",
    ].join('\n')
    expect(generateMutants('types.ts', sample)).toEqual([])
  })
})

describe('scoreMutants', () => {
  it('computes survival percentage and lists surviving mutants', () => {
    const mutants = generateMutants('demo.ts', 'export const ok = (a: boolean, b: boolean) => a && !b\n')
    const report = scoreMutants(
      'demo.ts',
      mutants.map((mutant, idx) => ({ durationMs: 10, killed: idx === 0, mutant })),
      100,
    )
    expect(report.total).toBe(2)
    expect(report.killed).toBe(1)
    expect(report.score).toBe(50)
    expect(report.survived).toHaveLength(1)
  })
})

describe('findRelatedTests and parseArgs', () => {
  it('maps source modules to their unit tests', () => {
    const related = findRelatedTests('src/server/http/forwarded-for.ts')
    expect(related.files).toContain('tests/unit/forwarded-for.test.ts')
    expect(related.projects).toEqual(['unit'])
  })

  it('parses --file, --changed, --since, --concurrency, and --json flags', () => {
    const parsed = parseArgs([
      '--file',
      './src/server/http/forwarded-for.ts',
      '--changed',
      '--since=HEAD^',
      '--concurrency',
      '2',
      '--json',
    ])
    expect(parsed).toEqual({
      changed: true,
      concurrency: 2,
      files: ['src/server/http/forwarded-for.ts'],
      json: true,
      since: 'HEAD^',
    })
  })
})
