import type { InfiniteData, QueryClient } from '@tanstack/react-query'
import { getMyPostsQueryOptions } from '#/features/posts/api/get-my-posts.ts'
import { getPublicPostsQueryOptions } from '#/features/posts/api/get-public-posts.ts'
import type { Invalidation } from '#/lib/query-client.ts'
import type { Post, PostPage } from '#/sdk/types.gen.ts'

const updatePosts = (update: (posts: Array<Post>) => Array<Post>) => (data: InfiniteData<PostPage> | undefined) =>
  data && { ...data, pages: data.pages.map((page) => ({ ...page, items: update(page.items) })) }

export const postListsChanged = (): ReadonlyArray<Invalidation> => [
  { queryKey: getMyPostsQueryOptions().queryKey },
  { firstPageOnly: true, inactiveToo: true, queryKey: getPublicPostsQueryOptions().queryKey },
]

export const replaceMyPost = (queryClient: QueryClient, post: Post) =>
  queryClient.setQueryData(
    getMyPostsQueryOptions().queryKey,
    updatePosts((posts) => posts.map((current) => (current.id === post.id ? post : current))),
  )

export const dropMyPost = (queryClient: QueryClient, id: string) =>
  queryClient.setQueryData(
    getMyPostsQueryOptions().queryKey,
    updatePosts((posts) => posts.filter((current) => current.id !== id)),
  )
