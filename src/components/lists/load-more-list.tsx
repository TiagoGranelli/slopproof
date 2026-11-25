import { hashKey, useQueryClient } from '@tanstack/react-query'
import type {
  InfiniteData,
  QueryCacheNotifyEvent,
  QueryClient,
  QueryKey,
  UseSuspenseInfiniteQueryResult,
} from '@tanstack/react-query'
import { useCallback, useReducer, useRef, useState, useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import { ApiErrorAlert } from '#/components/errors/api-error-alert.tsx'
import { firstAppendedItemId, transitionLoadMore } from '#/components/lists/load-more-machine.ts'
import { Button } from '#/components/ui/button.tsx'

type Pages<Item> = Pick<
  UseSuspenseInfiniteQueryResult<InfiniteData<{ readonly items: ReadonlyArray<Item> }>, unknown>,
  'data' | 'fetchNextPage' | 'fetchStatus' | 'hasNextPage' | 'isFetchingNextPage' | 'refetch'
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
  readonly error: unknown
  readonly revision: string
}

type CachedQuery = QueryCacheNotifyEvent['query']

const queryIds = new WeakMap<CachedQuery, number>()
let nextQueryId = 1

const queryId = (query: CachedQuery) => {
  const existing = queryIds.get(query)
  if (existing !== undefined) {
    return existing
  }
  const assigned = nextQueryId
  nextQueryId += 1
  queryIds.set(query, assigned)
  return assigned
}

const queryRevision = (queryClient: QueryClient, queryKey: QueryKey) => {
  const query = queryClient.getQueryCache().find({ exact: true, queryKey })
  return query ? `${queryId(query)}:${query.state.dataUpdateCount}` : '0:0'
}

const serverRevision = () => '0:0'

const useQueryDataRevision = (queryClient: QueryClient, queryKey: QueryKey) => {
  const targetHash = hashKey(queryKey)
  const subscribe = useCallback(
    (onChange: () => void) =>
      queryClient.getQueryCache().subscribe((event: QueryCacheNotifyEvent) => {
        if (event.query.queryHash === targetHash) {
          onChange()
        }
      }),
    [queryClient, targetHash],
  )
  return useSyncExternalStore(subscribe, () => queryRevision(queryClient, queryKey), serverRevision)
}

interface FetchTracker {
  error: unknown
  fetchCount: number
  hasError: boolean
  ownSuccess: boolean
  superseded: boolean
}

type QueryUpdatedAction = Extract<QueryCacheNotifyEvent, { type: 'updated' }>['action']

const trackQueryAction = (tracker: FetchTracker, action: QueryUpdatedAction) => {
  if (action.type === 'fetch') {
    tracker.fetchCount += 1
    tracker.superseded = tracker.superseded || tracker.fetchCount > 1
  } else if (action.type === 'setState') {
    tracker.superseded = true
  } else if (!tracker.superseded && tracker.fetchCount === 1 && action.type === 'error') {
    tracker.hasError = true
    tracker.error = action.error
  } else if (!tracker.superseded && tracker.fetchCount === 1 && action.type === 'success' && !action.manual) {
    tracker.ownSuccess = true
  }
}

const trackQueryEvent = (tracker: FetchTracker, targetHash: string, event: QueryCacheNotifyEvent) => {
  if (event.query.queryHash !== targetHash) {
    return
  }
  if (event.type === 'removed') {
    tracker.superseded = true
  } else if (event.type === 'updated') {
    trackQueryAction(tracker, event.action)
  }
}

type OwnedFetchOutcome<T> =
  | { readonly error: unknown; readonly kind: 'error'; readonly revision: string }
  | { readonly kind: 'success'; readonly outcome: T }
  | { readonly kind: 'superseded' }

const resolveOwnedFetch = <T,>(tracker: FetchTracker, outcome: T, revision: string): OwnedFetchOutcome<T> => {
  if (tracker.superseded || tracker.fetchCount !== 1) {
    return { kind: 'superseded' }
  }
  if (tracker.hasError) {
    return { error: tracker.error, kind: 'error', revision }
  }
  return tracker.ownSuccess ? { kind: 'success', outcome } : { kind: 'superseded' }
}

const newTracker = (): FetchTracker => ({
  error: undefined,
  fetchCount: 0,
  hasError: false,
  ownSuccess: false,
  superseded: false,
})

const runOwnedFetch = async <T,>(
  queryClient: QueryClient,
  queryKey: QueryKey,
  start: () => Promise<T>,
): Promise<OwnedFetchOutcome<T>> => {
  const targetHash = hashKey(queryKey)
  const tracker = newTracker()
  const unsubscribe = queryClient.getQueryCache().subscribe((event) => trackQueryEvent(tracker, targetHash, event))
  try {
    const outcome = await start()
    return resolveOwnedFetch(tracker, outcome, queryRevision(queryClient, queryKey))
  } finally {
    unsubscribe()
  }
}

const readIdlePageState = (queryClient: QueryClient, queryKey: QueryKey) => {
  const current = queryClient.getQueryState<InfiniteData<unknown>>(queryKey)
  if (!current?.data || current.fetchStatus !== 'idle') {
    return null
  }
  return { needsRefresh: current.isInvalidated || current.status === 'error', pageCount: current.data.pages.length }
}

interface AppendRequest<Item> {
  readonly pages: Pages<Item>
  readonly queryClient: QueryClient
  readonly queryKey: QueryKey
  readonly readCurrent: () => ReturnType<typeof readIdlePageState>
}

const toFailure = (failed: { readonly error: unknown; readonly revision: string }) => ({
  failure: { error: failed.error, revision: failed.revision },
})

const refreshBeforeAppend = async <Item,>(
  request: AppendRequest<Item>,
  current: NonNullable<ReturnType<typeof readIdlePageState>>,
) => {
  if (!current.needsRefresh) {
    return { kind: 'ready' as const, state: current }
  }
  const refreshed = await runOwnedFetch(request.queryClient, request.queryKey, () => request.pages.refetch())
  if (refreshed.kind === 'error') {
    return { failure: toFailure(refreshed), kind: 'abort' as const }
  }
  const next = request.readCurrent()
  const hasMore =
    refreshed.kind === 'success' && 'hasNextPage' in refreshed.outcome && refreshed.outcome.hasNextPage === true
  if (!hasMore || !next || next.needsRefresh) {
    return { failure: null, kind: 'abort' as const }
  }
  return { kind: 'ready' as const, state: next }
}

const requestAppend = async <Item extends { readonly id: string }>(request: AppendRequest<Item>) => {
  const initial = request.readCurrent()
  if (!initial) {
    return null
  }
  const ready = await refreshBeforeAppend(request, initial)
  if (ready.kind === 'abort') {
    return ready.failure
  }
  const fetched = await runOwnedFetch(request.queryClient, request.queryKey, () => request.pages.fetchNextPage())
  if (fetched.kind === 'error') {
    return toFailure(fetched)
  }
  return fetched.kind === 'success'
    ? { appendedId: firstAppendedItemId(ready.state.pageCount, fetched.outcome.data?.pages ?? []) }
    : null
}

const applyAppendOutcome = (
  outcome: Awaited<ReturnType<typeof requestAppend>> | null,
  setFailure: (failure: LoadMoreFailure) => void,
  dispatch: (event: { readonly focusId: string; readonly type: 'FOCUS_APPENDED' }) => void,
) => {
  if (outcome === null) {
    return
  }
  if ('failure' in outcome) {
    setFailure(outcome.failure)
  } else if (outcome.appendedId !== null) {
    dispatch({ focusId: outcome.appendedId, type: 'FOCUS_APPENDED' })
  }
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
  const dataRevision = useQueryDataRevision(queryClient, queryKey)
  const mounted = useRef<symbol | null>(null)
  const { attachButton, button } = usePaginationButton()
  const busy = pages.fetchStatus !== 'idle'
  const shownFailure = failure?.revision === dataRevision ? failure : null

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
    const outcome = await requestAppend({
      pages,
      queryClient,
      queryKey,
      readCurrent: () => (mounted.current === mount ? readIdlePageState(queryClient, queryKey) : null),
    })
    if (mounted.current !== mount) {
      return
    }
    applyAppendOutcome(outcome, setFailure, dispatch)
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
      {shownFailure ? <ApiErrorAlert action={`load more ${noun}`} error={shownFailure.error} /> : null}
    </div>
  )
}
