import { useQueryClient } from '@tanstack/react-query'
import type { InfiniteData, QueryClient, QueryKey, UseSuspenseInfiniteQueryResult } from '@tanstack/react-query'
import { useCallback, useReducer, useRef } from 'react'
import type { ReactNode } from 'react'
import { ApiErrorAlert } from '#/components/errors/api-error-alert.tsx'
import { firstAppendedItemId, transitionLoadMore } from '#/components/lists/load-more-machine.ts'
import { Button } from '#/components/ui/button.tsx'

type Pages<Item> = Pick<
  UseSuspenseInfiniteQueryResult<InfiniteData<{ readonly items: ReadonlyArray<Item> }>, unknown>,
  | 'data'
  | 'error'
  | 'fetchNextPage'
  | 'fetchStatus'
  | 'hasNextPage'
  | 'isFetchingNextPage'
  | 'isFetchNextPageError'
  | 'refetch'
>

const loadMoreLabel = (noun: string, pages: Pick<Pages<unknown>, 'fetchStatus' | 'isFetchingNextPage'>) => {
  if (pages.fetchStatus === 'paused') {
    return 'Waiting for connection…'
  }
  if (pages.fetchStatus === 'idle') {
    return `Load more ${noun}`
  }
  return pages.isFetchingNextPage ? `Loading more ${noun}…` : `Refreshing ${noun}…`
}

const ownsPaginationFocus = (owner: Document, button: HTMLButtonElement | null, hasNextPage: boolean) => {
  const { activeElement, body } = owner
  return (
    (activeElement === button && button !== null) ||
    (!hasNextPage && (activeElement === body || activeElement === null))
  )
}

const readIdlePageState = (queryClient: QueryClient, queryKey: QueryKey) => {
  const current = queryClient.getQueryState<InfiniteData<unknown>>(queryKey)
  if (!current?.data || current.fetchStatus !== 'idle') {
    return null
  }
  return { needsRefresh: current.isInvalidated || current.status === 'error', pageCount: current.data.pages.length }
}

const requestAppend = async <Item extends { readonly id: string }>(
  pages: Pages<Item>,
  readCurrent: () => ReturnType<typeof readIdlePageState>,
  isStillMounted: () => boolean,
) => {
  let current = readCurrent()
  if (!current) {
    return null
  }
  if (current.needsRefresh) {
    const refreshed = await pages.refetch()
    current = readCurrent()
    if (!isStillMounted() || !refreshed.isSuccess || current?.needsRefresh !== false) {
      return null
    }
  }
  const fetched = await pages.fetchNextPage()
  if (!isStillMounted() || !fetched.isSuccess) {
    return null
  }
  return firstAppendedItemId(current.pageCount, fetched.data.pages)
}

export function LoadMoreList<Item extends { readonly id: string }>(props: {
  empty: string
  noun: string
  pages: Pages<Item>
  queryKey: QueryKey
  renderItem: (entry: Item) => ReactNode
  testId: string
}) {
  const { noun, pages, queryKey } = props
  const queryClient = useQueryClient()
  const items = pages.data.pages.flatMap((page) => page.items)
  const [focusId, dispatch] = useReducer(transitionLoadMore, null)
  const mounted = useRef<symbol | null>(null)
  const button = useRef<HTMLButtonElement>(null)
  const busy = pages.fetchStatus !== 'idle'

  const attachList = useCallback((node: HTMLDivElement | null) => {
    mounted.current = node ? Symbol('mounted list') : null
  }, [])

  const focusLoadedItem = (node: HTMLLIElement | null) => {
    if (!node) {
      return
    }
    if (ownsPaginationFocus(node.ownerDocument, button.current, pages.hasNextPage)) {
      node.focus()
    }
    dispatch({ type: 'FOCUS_APPLIED' })
  }

  const loadMore = async () => {
    const mount = mounted.current
    if (!mount || busy || !pages.hasNextPage) {
      return
    }
    const appendedId = await requestAppend(
      pages,
      () => readIdlePageState(queryClient, queryKey),
      () => mounted.current === mount,
    )
    if (appendedId !== null && mounted.current === mount) {
      dispatch({ focusId: appendedId, type: 'FOCUS_APPENDED' })
    }
  }

  if (items.length === 0) {
    return (
      <p className="text-muted-foreground" data-testid={props.testId}>
        {props.empty}
      </p>
    )
  }

  return (
    <div className="grid gap-3" ref={attachList}>
      <ul className="grid gap-3" data-testid={props.testId}>
        {items.map((entry) => (
          <li
            className="rounded-xl"
            key={entry.id}
            ref={entry.id === focusId ? focusLoadedItem : undefined}
            tabIndex={-1}
          >
            {props.renderItem(entry)}
          </li>
        ))}
      </ul>
      {pages.hasNextPage ? (
        <Button
          aria-disabled={busy || undefined}
          className="justify-self-center"
          onClick={() => void loadMore()}
          ref={button}
          type="button"
          variant="outline"
        >
          {loadMoreLabel(noun, pages)}
        </Button>
      ) : null}
      {!busy && pages.isFetchNextPageError ? <ApiErrorAlert action={`load more ${noun}`} error={pages.error} /> : null}
    </div>
  )
}
