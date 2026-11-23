import { useSuspenseInfiniteQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { Page } from '#/components/layouts/page.tsx'
import { pageTitle } from '#/config/app.ts'
import { getPublicPostsQueryOptions } from '#/features/posts/api/get-public-posts.ts'
import { PostList } from '#/features/posts/components/post-list.tsx'

export const Route = createFileRoute('/')({
  loader: ({ context }) => context.queryClient.infiniteQuery({ ...getPublicPostsQueryOptions(), staleTime: 'static' }),
  head: () => ({ meta: [{ title: pageTitle('Latest posts') }] }),
  headers: () => ({ 'cache-control': 'private, no-store' }),
  component: Home,
})

function Home() {
  const options = getPublicPostsQueryOptions()
  const posts = useSuspenseInfiniteQuery(options)
  return (
    <Page title="Latest posts">
      <PostList empty="No posts yet." pages={posts} queryKey={options.queryKey} testId="public-posts" />
    </Page>
  )
}
