import * as fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  initialLoadMoreState,
  reconcileLoadMoreState,
  transitionLoadMore,
} from '#/components/lists/load-more-machine.ts'
import type { LoadMoreEvent, LoadMoreState } from '#/components/lists/load-more-machine.ts'

interface LoadMoreModel {
  focusIndex: number | null
  hasNextPage: boolean
  inFlight: number
  loadedCount: number
  status: LoadMoreState['status']
}

interface LoadMoreReal {
  state: LoadMoreState
}

const assertLoadMoreInvariants = (model: LoadMoreModel, real: LoadMoreReal) => {
  const { state } = real
  expect(state.status).toBe(model.status)
  expect(state.loadedCount).toBe(model.loadedCount)
  expect(model.inFlight).toBeLessThanOrEqual(1)
  expect(state.status === 'loading').toBe(model.inFlight === 1)
  if (state.status === 'idle' || state.status === 'exhausted') {
    expect(state.focusIndex).toBe(model.focusIndex)
    if (state.focusIndex !== null) {
      expect(state.focusIndex).toBeGreaterThanOrEqual(0)
      expect(state.focusIndex).toBeLessThan(state.loadedCount)
    }
  }
}

const send = (real: LoadMoreReal, event: LoadMoreEvent) => {
  real.state = transitionLoadMore(real.state, event)
}

class LoadMoreCommand implements fc.Command<LoadMoreModel, LoadMoreReal> {
  check = () => true
  run(model: LoadMoreModel, real: LoadMoreReal) {
    send(real, { type: 'LOAD_MORE' })
    if (model.status === 'idle' || model.status === 'error') {
      model.status = 'loading'
      model.inFlight = 1
      model.focusIndex = null
    }
    assertLoadMoreInvariants(model, real)
  }
  toString = () => 'LOAD_MORE'
}

class LoadSucceededCommand implements fc.Command<LoadMoreModel, LoadMoreReal> {
  readonly addedCount: number
  readonly hasNextPage: boolean
  constructor(addedCount: number, hasNextPage: boolean) {
    this.addedCount = addedCount
    this.hasNextPage = hasNextPage
  }
  check = () => true
  run(model: LoadMoreModel, real: LoadMoreReal) {
    send(real, { addedCount: this.addedCount, hasNextPage: this.hasNextPage, type: 'LOAD_SUCCEEDED' })
    if (model.status === 'loading') {
      const added = Math.max(0, Math.trunc(this.addedCount))
      const previous = model.loadedCount
      model.loadedCount = previous + added
      model.focusIndex = added > 0 ? previous : null
      model.hasNextPage = this.hasNextPage
      model.status = this.hasNextPage ? 'idle' : 'exhausted'
      model.inFlight = 0
    }
    assertLoadMoreInvariants(model, real)
  }
  toString = () => `LOAD_SUCCEEDED(added=${this.addedCount}, more=${String(this.hasNextPage)})`
}

class LoadFailedCommand implements fc.Command<LoadMoreModel, LoadMoreReal> {
  check = () => true
  run(model: LoadMoreModel, real: LoadMoreReal) {
    send(real, { error: new Error('offline'), type: 'LOAD_FAILED' })
    if (model.status === 'loading') {
      model.status = 'error'
      model.inFlight = 0
      model.focusIndex = null
    }
    assertLoadMoreInvariants(model, real)
  }
  toString = () => 'LOAD_FAILED'
}

class FocusAppliedCommand implements fc.Command<LoadMoreModel, LoadMoreReal> {
  check = () => true
  run(model: LoadMoreModel, real: LoadMoreReal) {
    send(real, { type: 'FOCUS_APPLIED' })
    if ((model.status === 'idle' || model.status === 'exhausted') && model.focusIndex !== null) {
      model.focusIndex = null
    }
    assertLoadMoreInvariants(model, real)
  }
  toString = () => 'FOCUS_APPLIED'
}

class ReconcileExternalCommand implements fc.Command<LoadMoreModel, LoadMoreReal> {
  readonly hasNextPage: boolean
  readonly itemCount: number
  constructor(itemCount: number, hasNextPage: boolean) {
    this.itemCount = itemCount
    this.hasNextPage = hasNextPage
  }
  check = () => true
  run(model: LoadMoreModel, real: LoadMoreReal) {
    real.state = reconcileLoadMoreState(real.state, { hasNextPage: this.hasNextPage, itemCount: this.itemCount })
    const clamped = Math.max(0, Math.trunc(this.itemCount))
    model.loadedCount = clamped
    model.hasNextPage = this.hasNextPage
    if (model.status === 'error' && !this.hasNextPage) {
      model.status = 'exhausted'
      model.focusIndex = null
    } else if (model.status === 'idle' || model.status === 'exhausted') {
      model.status = this.hasNextPage ? 'idle' : 'exhausted'
      model.focusIndex = model.focusIndex !== null && model.focusIndex < clamped ? model.focusIndex : null
    }
    assertLoadMoreInvariants(model, real)
  }
  toString = () => `RECONCILE(count=${this.itemCount}, more=${String(this.hasNextPage)})`
}

const commandArbitrary = fc.commands(
  [
    fc.constant(new LoadMoreCommand()),
    fc
      .tuple(fc.integer({ max: 10, min: 0 }), fc.boolean())
      .map(([added, more]) => new LoadSucceededCommand(added, more)),
    fc.constant(new LoadFailedCommand()),
    fc.constant(new FocusAppliedCommand()),
    fc
      .tuple(fc.integer({ max: 20, min: 0 }), fc.boolean())
      .map(([count, more]) => new ReconcileExternalCommand(count, more)),
  ],
  { maxCommands: 40 },
)

describe('load-more-machine', () => {
  it('focuses the first new item even when the loaded page exhausts the list', () => {
    const start = initialLoadMoreState({ hasNextPage: true, itemCount: 2 })
    const loading = transitionLoadMore(start, { type: 'LOAD_MORE' })
    const exhausted = transitionLoadMore(loading, { addedCount: 2, hasNextPage: false, type: 'LOAD_SUCCEEDED' })
    expect(exhausted).toEqual({ focusIndex: 2, loadedCount: 4, status: 'exhausted' })
    expect(transitionLoadMore(exhausted, { type: 'LOAD_MORE' })).toEqual(exhausted)
    expect(transitionLoadMore(exhausted, { type: 'FOCUS_APPLIED' })).toEqual({
      focusIndex: null,
      loadedCount: 4,
      status: 'exhausted',
    })
  })

  it('reconciles external list changes without leaving an out-of-bounds focus index', () => {
    const idleWithFocus = transitionLoadMore(
      transitionLoadMore(initialLoadMoreState({ hasNextPage: true, itemCount: 2 }), { type: 'LOAD_MORE' }),
      { addedCount: 2, hasNextPage: true, type: 'LOAD_SUCCEEDED' },
    )
    expect(reconcileLoadMoreState(idleWithFocus, { hasNextPage: false, itemCount: 1 })).toEqual({
      focusIndex: null,
      loadedCount: 1,
      status: 'exhausted',
    })
  })

  it('handles every state, event and reconciliation pair deterministically', () => {
    const states: Array<LoadMoreState> = [
      { focusIndex: null, loadedCount: 2, status: 'idle' },
      { focusIndex: 1, loadedCount: 2, status: 'idle' },
      { loadedCount: 2, status: 'loading' },
      { error: new Error('offline'), loadedCount: 2, status: 'error' },
      { focusIndex: null, loadedCount: 2, status: 'exhausted' },
      { focusIndex: 1, loadedCount: 2, status: 'exhausted' },
    ]
    const events: Array<LoadMoreEvent> = [
      { type: 'LOAD_MORE' },
      { addedCount: 0, hasNextPage: false, type: 'LOAD_SUCCEEDED' },
      { addedCount: 2, hasNextPage: true, type: 'LOAD_SUCCEEDED' },
      { error: new Error('offline'), type: 'LOAD_FAILED' },
      { type: 'FOCUS_APPLIED' },
    ]
    const transitions = states.flatMap((state) => events.map((event) => transitionLoadMore(state, event)))
    const reconciled = states.flatMap((state) => [
      reconcileLoadMoreState(state, { hasNextPage: true, itemCount: 3 }),
      reconcileLoadMoreState(state, { hasNextPage: false, itemCount: 0 }),
    ])
    expect(transitions.length + reconciled.length).toBe(states.length * (events.length + 2))
  })

  it('preserves all invariants across arbitrary event and external-sync sequences', () => {
    fc.assert(
      fc.property(fc.integer({ max: 10, min: 0 }), fc.boolean(), commandArbitrary, (itemCount, hasNextPage, cmds) => {
        const model: LoadMoreModel = {
          focusIndex: null,
          hasNextPage,
          inFlight: 0,
          loadedCount: itemCount,
          status: hasNextPage ? 'idle' : 'exhausted',
        }
        const real: LoadMoreReal = { state: initialLoadMoreState({ hasNextPage, itemCount }) }
        fc.modelRun(() => ({ model, real }), cmds)
        expect(real.state.status).toBe(model.status)
      }),
      { numRuns: 200 },
    )
  })
})
