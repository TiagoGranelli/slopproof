import * as fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  firstAppendedItemId,
  INITIAL_LOAD_MORE_STATE,
  transitionLoadMore,
} from '#/components/lists/load-more-machine.ts'

describe('load-more-machine', () => {
  it('focuses the first item in the appended page and clears focus after applying it', () => {
    const pages = [{ items: [{ id: 'existing' }] }, { items: [{ id: 'older' }, { id: 'oldest' }] }]
    const request = Symbol('next page request')
    const loading = transitionLoadMore(INITIAL_LOAD_MORE_STATE, { request, type: 'LOAD_MORE' })
    const focusId = firstAppendedItemId(1, pages)
    const finished = transitionLoadMore(loading, { focusId, request, type: 'LOAD_FINISHED' })
    expect(finished.focusId).toBe('older')
    expect(transitionLoadMore(finished, { type: 'FOCUS_APPLIED' })).toEqual(INITIAL_LOAD_MORE_STATE)
  })

  it('ignores a superseded request that settles after a new request starts', () => {
    const request = Symbol('next page request')
    const loading = transitionLoadMore(INITIAL_LOAD_MORE_STATE, { request, type: 'LOAD_MORE' })
    const replacement = transitionLoadMore(loading, { request: Symbol('next page request'), type: 'LOAD_MORE' })
    expect(transitionLoadMore(replacement, { focusId: 'old', request, type: 'LOAD_FINISHED' })).toBe(replacement)
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
