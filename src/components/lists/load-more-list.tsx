import type { InfiniteData, UseSuspenseInfiniteQueryResult } from '@tanstack/react-query'
import { useReducer } from 'react'
import type { ReactNode } from 'react'
import { ApiErrorAlert } from '#/components/errors/api-error-alert.tsx'
import {
  initialLoadMoreState,
  reconcileLoadMoreState,
  transitionLoadMore,
} from '#/components/lists/load-more-machine.ts'
import { Button } from '#/components/ui/button.tsx'

type Pages<Item> = Pick<
  UseSuspenseInfiniteQueryResult<InfiniteData<{ readonly items: ReadonlyArray<Item> }>, unknown>,
  'data' | 'fetchNextPage' | 'hasNextPage'
>

export function LoadMoreList<Item extends { readonly id: string }>(props: {
  empty: string
  noun: string
  pages: Pages<Item>
  renderItem: (entry: Item) => ReactNode
  testId: string
}) {
  const { noun, pages } = props
  const items = pages.data.pages.flatMap((page) => page.items)
  const snapshot = { hasNextPage: pages.hasNextPage, itemCount: items.length }
  const [machine, dispatch] = useReducer(transitionLoadMore, snapshot, initialLoadMoreState)
  const view = reconcileLoadMoreState(machine, snapshot)

  const focusLoadedItem = (node: HTMLLIElement | null) => {
    if (!node) {
      return
    }
    node.focus()
    dispatch({ type: 'FOCUS_APPLIED' })
  }

  const loadMore = async () => {
    if (view.status === 'loading' || view.status === 'exhausted') {
      return
    }
    dispatch({ type: 'LOAD_MORE' })
    const fetched = await pages.fetchNextPage()
    if (fetched.isError) {
      dispatch({ error: fetched.error, type: 'LOAD_FAILED' })
      return
    }
    dispatch({
      addedCount: fetched.data?.pages.at(-1)?.items.length ?? 0,
      hasNextPage: fetched.hasNextPage,
      type: 'LOAD_SUCCEEDED',
    })
  }

  if (items.length === 0) {
    return (
      <p className="text-muted-foreground" data-testid={props.testId}>
        {props.empty}
      </p>
    )
  }

  const focusIndex = view.status === 'idle' || view.status === 'exhausted' ? view.focusIndex : null
  const loading = view.status === 'loading'

  return (
    <div className="grid gap-3">
      <ul className="grid gap-3" data-testid={props.testId}>
        {items.map((entry, index) => (
          <li
            className="rounded-xl"
            key={entry.id}
            ref={index === focusIndex ? focusLoadedItem : undefined}
            tabIndex={-1}
          >
            {props.renderItem(entry)}
          </li>
        ))}
      </ul>
      {view.status !== 'exhausted' ? (
        <Button
          aria-disabled={loading || undefined}
          className="justify-self-center"
          onClick={() => void loadMore()}
          type="button"
          variant="outline"
        >
          {loading ? `Loading more ${noun}…` : `Load more ${noun}`}
        </Button>
      ) : null}
      {view.status === 'error' ? <ApiErrorAlert action={`load more ${noun}`} error={view.error} /> : null}
    </div>
  )
}
