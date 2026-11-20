import * as fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { truncateCodePoints } from '#/lib/truncate-text.ts'

describe('truncateCodePoints', () => {
  it('keeps a supplementary Unicode character intact across the cut boundary', () => {
    const body = `${'a'.repeat(39)}🀀 tail`
    const truncated = truncateCodePoints(body, 40)
    expect(truncated).toBe(`${'a'.repeat(39)}🀀`)
    expect(truncated.isWellFormed()).toBe(true)
  })

  it('replaces lone surrogates so the output is always well-formed UTF-16', () => {
    const malformed = 'hello\uD83Cworld'
    const truncated = truncateCodePoints(malformed, 8)
    expect(truncated.isWellFormed()).toBe(true)
  })

  it('always returns a well-formed string within the code-point limit for arbitrary input', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'binary' }), fc.integer({ max: 60, min: 0 }), (text, limit) => {
        const truncated = truncateCodePoints(text, limit)
        expect(truncated.isWellFormed()).toBe(true)
        expect(Array.from(truncated).length).toBeLessThanOrEqual(limit)
      }),
    )
  })
})
