import { useQueryClient } from '@tanstack/react-query'
import type { InfiniteData, QueryClient, QueryKey, UseSuspenseInfiniteQueryResult } from '@tanstack/react-query'
import { useCallback, useReducer, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { ApiErrorAlert } from '#/components/errors/api-error-alert.tsx'
import { firstAppendedItemId, transitionLoadMore } from '#/components/lists/load-more-machine.ts'
import { Button } from '#/components/ui/button.tsx'

type Pages<Item> = Pick<
  UseSuspenseInfiniteQueryResult<InfiniteData<{ readonly items: ReadonlyArray<Item> }>, unknown>,
  'data' | 'dataUpdatedAt' | 'fetchNextPage' | 'fetchStatus' | 'hasNextPage' | 'isFetchingNextPage' | 'refetch'
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

type PaginationButton = HTMLButtonElement | 'removed-while-focused' | null

const ownsPaginationFocus = (owner: Document, button: PaginationButton, hasNextPage: boolean) => {
  const { activeElement, body } = owner
  return (
    (activeElement === button && button !== null) ||
    (!hasNextPage && button === 'removed-while-focused' && (activeElement === body || activeElement === null))
  )
}

const usePaginationButton = () => {
  const button = useRef<PaginationButton>(null)
  const attachButton = useCallback((node: HTMLButtonElement | null) => {
    if (!node) {
      return undefined
    }
    button.current = node
    return () => {
      button.current = node.ownerDocument.activeElement === node ? 'removed-while-focused' : null
    }
  }, [])
  return { attachButton, button }
}

interface LoadMoreFailure {
  readonly data: unknown
  readonly dataUpdatedAt: number
  readonly error: unknown
}

const failureOf = (settled: LoadMoreFailure): LoadMoreFailure => ({
  data: settled.data,
  dataUpdatedAt: settled.dataUpdatedAt,
  error: settled.error,
})

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
) => {
  let current = readCurrent()
  if (!current) {
    return null
  }
  if (current.needsRefresh) {
    const refreshed = await pages.refetch()
    if (refreshed.isRefetchError) {
      return { failure: failureOf(refreshed) }
    }
    current = readCurrent()
    if (!refreshed.isSuccess || current?.needsRefresh !== false) {
      return null
    }
  }
  const fetched = await pages.fetchNextPage()
  if (fetched.isFetchNextPageError) {
    return { failure: failureOf(fetched) }
  }
  return fetched.isSuccess ? { appendedId: firstAppendedItemId(current.pageCount, fetched.data.pages) } : null
}

interface LoadMoreListProps<Item> {
  empty: string
  noun: string
  pages: Pages<Item>
  queryKey: QueryKey
  renderItem: (entry: Item) => ReactNode
  testId: string
}

export function LoadMoreList<Item extends { readonly id: string }>(props: LoadMoreListProps<Item>) {
  const { noun, pages, queryKey } = props
  const queryClient = useQueryClient()
  const items = pages.data.pages.flatMap((page) => page.items)
  const [focusId, dispatch] = useReducer(transitionLoadMore, null)
  const [failure, setFailure] = useState<LoadMoreFailure | null>(null)
  const mounted = useRef<symbol | null>(null)
  const { attachButton, button } = usePaginationButton()
  const busy = pages.fetchStatus !== 'idle'
  const shownFailure = failure?.data === pages.data && failure.dataUpdatedAt === pages.dataUpdatedAt ? failure : null

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
    const outcome = await requestAppend(pages, () =>
      mounted.current === mount ? readIdlePageState(queryClient, queryKey) : null,
    )
    if (outcome === null || mounted.current !== mount) {
      return
    }
    if (outcome.failure) {
      setFailure(outcome.failure)
    } else if (outcome.appendedId !== null) {
      dispatch({ focusId: outcome.appendedId, type: 'FOCUS_APPENDED' })
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
          ref={attachButton}
          type="button"
          variant="outline"
        >
          {loadMoreLabel(noun, pages)}
        </Button>
      ) : null}
      {!busy && shownFailure ? <ApiErrorAlert action={`load more ${noun}`} error={shownFailure.error} /> : null}
    </div>
  )
}
