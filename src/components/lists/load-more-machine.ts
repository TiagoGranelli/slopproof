export interface LoadMoreState {
  readonly focusId: string | null
  readonly request: symbol | null
}

export type LoadMoreEvent =
  | { readonly request: symbol; readonly type: 'LOAD_MORE' }
  | { readonly focusId: string | null; readonly request: symbol; readonly type: 'LOAD_FINISHED' }
  | { readonly type: 'FOCUS_APPLIED' }

export const INITIAL_LOAD_MORE_STATE: LoadMoreState = { focusId: null, request: null }

export const firstAppendedItemId = (
  pageCount: number,
  pages: ReadonlyArray<{ readonly items: ReadonlyArray<{ readonly id: string }> }>,
): string | null => pages[pageCount]?.items[0]?.id ?? null

export const transitionLoadMore = (state: LoadMoreState, event: LoadMoreEvent): LoadMoreState => {
  switch (event.type) {
    case 'LOAD_MORE':
      return { focusId: null, request: event.request }
    case 'LOAD_FINISHED':
      return state.request === event.request ? { focusId: event.focusId, request: null } : state
    case 'FOCUS_APPLIED':
      return INITIAL_LOAD_MORE_STATE
  }
}
