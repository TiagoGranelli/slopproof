/** Snapshot of the query's current list length and pagination cursor presence. */
export interface LoadMoreSnapshot {
  readonly hasNextPage: boolean
  readonly itemCount: number
}

/** Explicit states of a load-more paginated list and its pending focus target. */
export type LoadMoreState =
  | { readonly focusIndex: number | null; readonly loadedCount: number; readonly status: 'idle' }
  | { readonly loadedCount: number; readonly status: 'loading' }
  | { readonly error: unknown; readonly loadedCount: number; readonly status: 'error' }
  | { readonly focusIndex: number | null; readonly loadedCount: number; readonly status: 'exhausted' }

/** Every event the load-more pagination state chart handles. */
export type LoadMoreEvent =
  | { readonly type: 'LOAD_MORE' }
  | { readonly addedCount: number; readonly hasNextPage: boolean; readonly type: 'LOAD_SUCCEEDED' }
  | { readonly error: unknown; readonly type: 'LOAD_FAILED' }
  | { readonly type: 'FOCUS_APPLIED' }

const clampCount = (count: number): number => Math.max(0, Math.trunc(count))

const clampFocus = (focusIndex: number | null, itemCount: number): number | null =>
  focusIndex !== null && focusIndex >= 0 && focusIndex < itemCount ? focusIndex : null

/** Initial state for a paginated list seeded with `snapshot`. */
export const initialLoadMoreState = (snapshot: LoadMoreSnapshot): LoadMoreState => {
  const loadedCount = clampCount(snapshot.itemCount)
  return snapshot.hasNextPage
    ? { focusIndex: null, loadedCount, status: 'idle' }
    : { focusIndex: null, loadedCount, status: 'exhausted' }
}

/**
 * Reconciles the machine state with external query updates (for example, a post created or deleted in another
 * component), keeping `focusIndex` strictly in bounds without effects.
 */
export const reconcileLoadMoreState = (state: LoadMoreState, snapshot: LoadMoreSnapshot): LoadMoreState => {
  const loadedCount = clampCount(snapshot.itemCount)
  switch (state.status) {
    case 'loading':
      return { loadedCount, status: 'loading' }
    case 'error':
      return snapshot.hasNextPage
        ? { error: state.error, loadedCount, status: 'error' }
        : { focusIndex: null, loadedCount, status: 'exhausted' }
    case 'idle':
    case 'exhausted': {
      const focusIndex = clampFocus(state.focusIndex, loadedCount)
      return snapshot.hasNextPage
        ? { focusIndex, loadedCount, status: 'idle' }
        : { focusIndex, loadedCount, status: 'exhausted' }
    }
  }
}

const transitionIdle = (
  state: Extract<LoadMoreState, { readonly status: 'idle' }>,
  event: LoadMoreEvent,
): LoadMoreState => {
  switch (event.type) {
    case 'LOAD_MORE':
      return { loadedCount: state.loadedCount, status: 'loading' }
    case 'FOCUS_APPLIED':
      return state.focusIndex !== null ? { ...state, focusIndex: null } : state
    case 'LOAD_FAILED':
    case 'LOAD_SUCCEEDED':
      return state
  }
}

const transitionLoading = (
  state: Extract<LoadMoreState, { readonly status: 'loading' }>,
  event: LoadMoreEvent,
): LoadMoreState => {
  switch (event.type) {
    case 'LOAD_SUCCEEDED': {
      const added = clampCount(event.addedCount)
      const loadedCount = state.loadedCount + added
      const focusIndex = added > 0 ? state.loadedCount : null
      return event.hasNextPage
        ? { focusIndex, loadedCount, status: 'idle' }
        : { focusIndex, loadedCount, status: 'exhausted' }
    }
    case 'LOAD_FAILED':
      return { error: event.error, loadedCount: state.loadedCount, status: 'error' }
    case 'FOCUS_APPLIED':
    case 'LOAD_MORE':
      return state
  }
}

const transitionError = (
  state: Extract<LoadMoreState, { readonly status: 'error' }>,
  event: LoadMoreEvent,
): LoadMoreState => {
  switch (event.type) {
    case 'LOAD_MORE':
      return { loadedCount: state.loadedCount, status: 'loading' }
    case 'FOCUS_APPLIED':
    case 'LOAD_FAILED':
    case 'LOAD_SUCCEEDED':
      return state
  }
}

const transitionExhausted = (
  state: Extract<LoadMoreState, { readonly status: 'exhausted' }>,
  event: LoadMoreEvent,
): LoadMoreState => {
  switch (event.type) {
    case 'FOCUS_APPLIED':
      return state.focusIndex !== null ? { ...state, focusIndex: null } : state
    case 'LOAD_FAILED':
    case 'LOAD_MORE':
    case 'LOAD_SUCCEEDED':
      return state
  }
}

/** Pure state transition function for load-more pagination. */
export const transitionLoadMore = (state: LoadMoreState, event: LoadMoreEvent): LoadMoreState => {
  switch (state.status) {
    case 'idle':
      return transitionIdle(state, event)
    case 'loading':
      return transitionLoading(state, event)
    case 'error':
      return transitionError(state, event)
    case 'exhausted':
      return transitionExhausted(state, event)
  }
}
