import { infiniteQueryOptions } from '@tanstack/react-query'
import { apiClient } from '#/lib/api-client.ts'
import { firstPage, nextPage } from '#/lib/infinite-pages.ts'
import { publicPostsListInfiniteOptions } from '#/sdk/@tanstack/react-query.gen.ts'

/**
 * Every author's posts, newest first, one page per "Load more". Isomorphic: in-process during SSR,
 * same-origin fetch in the browser.
 */
export const getPublicPostsQueryOptions = () => {
  const { queryFn, ...options } = publicPostsListInfiniteOptions({ client: apiClient() })
  // Suspense requires a query function. The generated options never skip this query.
  if (typeof queryFn !== 'function') throw new Error('Expected a query function for public posts')
  return infiniteQueryOptions({
    ...options,
    queryFn,
    initialPageParam: firstPage,
    getNextPageParam: nextPage,
  })
}
