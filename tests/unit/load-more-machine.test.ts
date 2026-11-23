import * as fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { firstAppendedItemId, transitionLoadMore } from '#/components/lists/load-more-machine.ts'

describe('load-more-machine', () => {
  it('focuses the first item in the appended page and clears focus after applying it', () => {
    const pages = [{ items: [{ id: 'existing' }] }, { items: [{ id: 'older' }, { id: 'oldest' }] }]
    const focusId = firstAppendedItemId(1, pages)
    expect(focusId).toBe('older')
    const pending = transitionLoadMore(null, { focusId: 'older', type: 'FOCUS_APPENDED' })
    expect(pending).toBe(focusId)
    expect(transitionLoadMore(pending, { type: 'FOCUS_APPLIED' })).toBeNull()
  })

  it('never moves focus if the page count did not increase or the appended page is empty', () => {
    const pageArbitrary = fc.record({ items: fc.array(fc.record({ id: fc.string() })) })
    fc.assert(
      fc.property(fc.array(pageArbitrary), fc.nat(10), (pages, missingPages) => {
        expect(firstAppendedItemId(pages.length + missingPages, pages)).toBeNull()
        expect(firstAppendedItemId(pages.length, [...pages, { items: [] }])).toBeNull()
      }),
    )
  })
})
