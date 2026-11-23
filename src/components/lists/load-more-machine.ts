type LoadMoreEvent = { readonly focusId: string; readonly type: 'FOCUS_APPENDED' } | { readonly type: 'FOCUS_APPLIED' }

export const firstAppendedItemId = (
  pageCount: number,
  pages: ReadonlyArray<{ readonly items: ReadonlyArray<{ readonly id: string }> }>,
): string | null => pages[pageCount]?.items[0]?.id ?? null

export const transitionLoadMore = (_focusId: string | null, event: LoadMoreEvent): string | null =>
  event.type === 'FOCUS_APPENDED' ? event.focusId : null
