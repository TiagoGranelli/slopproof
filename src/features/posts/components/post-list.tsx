import type { InfiniteData, UseSuspenseInfiniteQueryResult } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { LoadMoreList } from '#/components/lists/load-more-list.tsx'
import { PostCard } from '#/features/posts/components/post-card.tsx'
import type { Post, PostPage } from '#/sdk/types.gen.ts'

export function PostList(props: {
  empty: string
  pages: UseSuspenseInfiniteQueryResult<InfiniteData<PostPage>, unknown>
  renderPost?: (post: Post) => ReactNode
  testId: string
}) {
  return (
    <LoadMoreList
      empty={props.empty}
      noun="posts"
      pages={props.pages}
      renderItem={props.renderPost ?? ((post) => <PostCard post={post} />)}
      testId={props.testId}
    />
  )
}
