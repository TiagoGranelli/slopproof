import { infiniteQueryOptions, type SkipToken } from '@tanstack/react-query'
import { apiClient } from '#/lib/api-client.ts'
import { firstPage, nextPage } from '#/lib/infinite-pages.ts'
import { publicPostsListInfiniteOptions } from '#/sdk/@tanstack/react-query.gen.ts'

export const getPublicPostsQueryOptions = () => {
  const { queryFn, ...options } = publicPostsListInfiniteOptions({ client: apiClient() })
  return infiniteQueryOptions({
    ...options,
    getNextPageParam: nextPage,
    initialPageParam: firstPage,
    queryFn: queryFn as Exclude<typeof queryFn, SkipToken | undefined>,
  })
}
