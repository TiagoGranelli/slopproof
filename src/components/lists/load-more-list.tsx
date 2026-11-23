import { useQueryClient } from '@tanstack/react-query'
import type { InfiniteData, QueryKey, UseSuspenseInfiniteQueryResult } from '@tanstack/react-query'
import { useCallback, useReducer, useRef } from 'react'
import type { ReactNode } from 'react'
import { ApiErrorAlert } from '#/components/errors/api-error-alert.tsx'
import { firstAppendedItemId, transitionLoadMore } from '#/components/lists/load-more-machine.ts'
import { Button } from '#/components/ui/button.tsx'

type Pages<Item> = Pick<
  UseSuspenseInfiniteQueryResult<InfiniteData<{ readonly items: ReadonlyArray<Item> }>, unknown>,
  'data' | 'error' | 'fetchNextPage' | 'fetchStatus' | 'hasNextPage' | 'isFetchingNextPage' | 'isFetchNextPageError'
>

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
  const busy = pages.fetchStatus !== 'idle'
  let buttonLabel = `Load more ${noun}`
  if (busy) {
    buttonLabel = pages.isFetchingNextPage ? `Loading more ${noun}…` : `Refreshing ${noun}…`
  }

  const attachList = useCallback((node: HTMLDivElement | null) => {
    mounted.current = node ? Symbol('mounted list') : null
  }, [])

  const focusLoadedItem = (node: HTMLLIElement | null) => {
    if (!node) {
      return
    }
    node.focus()
    dispatch({ type: 'FOCUS_APPLIED' })
  }

  const loadMore = async () => {
    const mount = mounted.current
    const current = queryClient.getQueryState<Pages<Item>['data']>(queryKey)
    if (!mount || busy || !pages.hasNextPage || !current?.data || current.fetchStatus !== 'idle') {
      return
    }
    const pageCount = current.data.pages.length
    const fetched = await pages.fetchNextPage()
    if (mounted.current !== mount || !fetched.isSuccess) {
      return
    }
    const appendedId = firstAppendedItemId(pageCount, fetched.data.pages)
    if (appendedId !== null) {
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
          type="button"
          variant="outline"
        >
          {buttonLabel}
        </Button>
      ) : null}
      {!busy && pages.isFetchNextPageError ? <ApiErrorAlert action={`load more ${noun}`} error={pages.error} /> : null}
    </div>
  )
}
