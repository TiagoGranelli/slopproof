import type { InfiniteData, UseSuspenseInfiniteQueryResult } from '@tanstack/react-query'
import { useReducer, type ReactNode } from 'react'
import { ApiErrorAlert } from '#/components/errors/api-error-alert.tsx'
import {
  initialLoadMoreState,
  reconcileLoadMoreState,
  transitionLoadMore,
} from '#/components/lists/load-more-machine.ts'
import { Button } from '#/components/ui/button.tsx'

/** The part of a suspense infinite query over `{ items, nextCursor }` pages that the list reads. */
type Pages<Item> = Pick<
  UseSuspenseInfiniteQueryResult<InfiniteData<{ readonly items: ReadonlyArray<Item> }>, unknown>,
  'data' | 'fetchNextPage' | 'hasNextPage'
>

/**
 * A paged list with a "Load more" button driven by `load-more-machine` (`idle`, `loading`, `error`, `exhausted`).
 * After a page loads, focus moves to its first new item via ref callback once committed, so keyboard and screen
 * reader users continue reading where the new items start instead of staying on a button below them.
 */
export function LoadMoreList<Item extends { readonly id: string }>(props: {
  empty: string
  /** Names the items in the button and its error: `posts` gives "Load more posts". */
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
    // aria-disabled rather than disabled while loading: a disabled button would drop keyboard focus.
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
