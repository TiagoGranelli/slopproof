import { infiniteQueryOptions } from '@tanstack/react-query'
import { apiClient } from '#/lib/api-client.ts'
import { firstPage, nextPage } from '#/lib/infinite-pages.ts'
import { publicPostsListInfiniteOptions } from '#/sdk/@tanstack/react-query.gen.ts'

export const getPublicPostsQueryOptions = () => {
  const { queryFn, ...options } = publicPostsListInfiniteOptions({ client: apiClient() })
  if (typeof queryFn !== 'function') {
    throw new TypeError('Expected a query function for the public posts')
  }
  return infiniteQueryOptions({
    ...options,
    getNextPageParam: nextPage,
    initialPageParam: firstPage,
    queryFn,
  })
}
