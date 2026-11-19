import type { InfiniteData, UseSuspenseInfiniteQueryResult } from '@tanstack/react-query'
import { useEffect, useRef, type ReactNode } from 'react'
import { ApiErrorAlert } from '#/components/errors/api-error-alert.tsx'
import { Button } from '#/components/ui/button.tsx'

/** The part of a suspense infinite query over `{ items, nextCursor }` pages that the list reads. */
type Pages<Item> = Pick<
  UseSuspenseInfiniteQueryResult<InfiniteData<{ readonly items: ReadonlyArray<Item> }>, unknown>,
  'data' | 'error' | 'fetchNextPage' | 'hasNextPage' | 'isFetchNextPageError' | 'isFetchingNextPage'
>

/**
 * A paged list with a "Load more" button (not infinite scroll: the footer stays reachable and the list only grows
 * when asked). After a page loads, focus moves to its first item, so keyboard and screen reader users continue
 * reading where the new items start instead of staying on a button below them.
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
  const list = useRef<HTMLUListElement>(null)
  // Index of the first item the pending "Load more" adds; focused once it renders.
  const focusOnLoad = useRef<number | null>(null)

  useEffect(() => {
    const index = focusOnLoad.current
    if (index === null || items.length <= index) {
      return
    }
    focusOnLoad.current = null
    list.current?.querySelectorAll<HTMLElement>(':scope > li')[index]?.focus()
  }, [items.length])

  const loadMore = async () => {
    // aria-disabled rather than disabled while loading: a disabled button would drop keyboard focus.
    if (pages.isFetchingNextPage) {
      return
    }
    focusOnLoad.current = items.length
    const fetched = await pages.fetchNextPage()
    // Nothing new rendered (an error, or the next page emptied meanwhile): focus stays on the button.
    if (fetched.isError || (fetched.data?.pages.at(-1)?.items.length ?? 0) === 0) {
      focusOnLoad.current = null
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
    <div className="grid gap-3">
      <ul className="grid gap-3" data-testid={props.testId} ref={list}>
        {items.map((entry) => (
          <li className="rounded-xl" key={entry.id} tabIndex={-1}>
            {props.renderItem(entry)}
          </li>
        ))}
      </ul>
      {pages.hasNextPage ? (
        <Button
          aria-disabled={pages.isFetchingNextPage || undefined}
          className="justify-self-center"
          onClick={() => void loadMore()}
          type="button"
          variant="outline"
        >
          {pages.isFetchingNextPage ? `Loading more ${noun}…` : `Load more ${noun}`}
        </Button>
      ) : null}
      {pages.isFetchNextPageError ? <ApiErrorAlert action={`load more ${noun}`} error={pages.error} /> : null}
    </div>
  )
}
