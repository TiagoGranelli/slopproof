import {
  type InfiniteData,
  MutationCache,
  QueryClient,
  type QueryClientConfig,
  type QueryKey,
} from '@tanstack/react-query'

export interface Invalidation {
  readonly firstPageOnly?: boolean
  readonly inactiveToo?: boolean
  readonly queryKey: QueryKey
}

type CacheEffects = {
  readonly clearsCache?: boolean
  readonly invalidates?: ReadonlyArray<Invalidation>
  readonly invalidatesOnError?: (error: unknown) => boolean
}

declare module '@tanstack/react-query' {
  interface Register {
    mutationMeta: CacheEffects
  }
}

const invalidate = (queryClient: QueryClient, invalidations: ReadonlyArray<Invalidation>) =>
  Promise.all(
    invalidations.map(({ firstPageOnly, inactiveToo, queryKey }) => {
      if (firstPageOnly) {
        queryClient.setQueriesData<InfiniteData<unknown>>(
          { exact: true, queryKey },
          (data) => data && { pageParams: data.pageParams.slice(0, 1), pages: data.pages.slice(0, 1) },
        )
      }
      return queryClient.invalidateQueries({ queryKey, refetchType: inactiveToo ? 'all' : 'active' })
    }),
  )

const createMutationCache = (getClient: () => QueryClient, onClear?: () => void) =>
  new MutationCache({
    // TanStack Query passes the mutation last, after data, variables and context: its signature, not ours.
    // oxlint-disable-next-line eslint/max-params
    onSettled: (_data, error, _variables, _context, mutation) => {
      const meta = mutation.meta
      const stale = error === null || (meta?.invalidatesOnError?.(error) ?? false)
      return stale && meta?.invalidates ? invalidate(getClient(), meta.invalidates) : undefined
    },
    // Same: TanStack Query's positional signature, with the mutation last.
    // oxlint-disable-next-line eslint/max-params
    onSuccess: (_data, _variables, _context, mutation) => {
      if (mutation.meta?.clearsCache) {
        getClient().clear()
        onClear?.()
      }
    },
  })

export function createQueryClient(
  config: QueryClientConfig = {},
  options: { readonly onClear?: () => void } = {},
): QueryClient {
  const queryClient: QueryClient = new QueryClient({
    ...config,
    mutationCache: createMutationCache(() => queryClient, options.onClear),
  })
  return queryClient
}
