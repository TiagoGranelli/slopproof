import { infiniteQueryOptions } from '@tanstack/react-query'
import { apiClient } from '#/lib/api-client.ts'
import { firstPage, nextPage } from '#/lib/infinite-pages.ts'
import { myPostsListInfiniteOptions } from '#/sdk/@tanstack/react-query.gen.ts'

/** The signed-in author's posts, newest first, in pages. Isomorphic, like getPublicPostsQueryOptions. */
export const getMyPostsQueryOptions = () => {
  const { queryFn, ...options } = myPostsListInfiniteOptions({ client: apiClient() })
  // Suspense requires a query function. The generated options never skip this query.
  if (typeof queryFn !== 'function') throw new Error('Expected a query function for the author’s posts')
  return infiniteQueryOptions({
    ...options,
    queryFn,
    initialPageParam: firstPage,
    getNextPageParam: nextPage,
  })
}
