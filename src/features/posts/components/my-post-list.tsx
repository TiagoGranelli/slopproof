import { useSuspenseInfiniteQuery } from '@tanstack/react-query'
import { getMyPostsQueryOptions } from '#/features/posts/api/get-my-posts.ts'
import { MyPost } from '#/features/posts/components/my-post.tsx'
import { PostList } from '#/features/posts/components/post-list.tsx'

export function MyPostList(props: { onDeleted?: () => void; onUpdated?: () => void }) {
  const posts = useSuspenseInfiniteQuery(getMyPostsQueryOptions())
  return (
    <PostList
      empty="You have not published anything yet."
      pages={posts}
      renderPost={(post) => <MyPost onDeleted={props.onDeleted} onUpdated={props.onUpdated} post={post} />}
      testId="my-posts"
    />
  )
}
