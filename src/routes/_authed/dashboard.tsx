import { createFileRoute } from '@tanstack/react-router'
import { useRef, useState } from 'react'
import { RouteError } from '#/components/errors/route-error.tsx'
import { SectionErrorBoundary } from '#/components/errors/section-error-boundary.tsx'
import { Page } from '#/components/layouts/page.tsx'
import { pageTitle } from '#/config/app.ts'
import { getMyPostsQueryOptions } from '#/features/posts/api/get-my-posts.ts'
import { MyPostList } from '#/features/posts/components/my-post-list.tsx'
import { PostComposer } from '#/features/posts/components/post-composer.tsx'

export const Route = createFileRoute('/_authed/dashboard')({
  loader: ({ context }) => context.queryClient.infiniteQuery({ ...getMyPostsQueryOptions(), staleTime: 'static' }),
  head: () => ({ meta: [{ title: pageTitle('Dashboard') }, { name: 'robots', content: 'noindex' }] }),
  errorComponent: (props) => <RouteError {...props} action="load your posts" title="Your posts could not be loaded" />,
  component: Dashboard,
})

function Dashboard() {
  const [status, setStatus] = useState({ id: 0, text: '' })
  const announce = (text: string) => setStatus((previous) => ({ id: previous.id + 1, text }))
  const listHeading = useRef<HTMLHeadingElement>(null)
  return (
    <Page title="Your posts">
      <SectionErrorBoundary action="show the post form">
        <PostComposer onPublished={() => announce('Post published.')} />
      </SectionErrorBoundary>
      <section aria-labelledby="published-heading" className="grid gap-4">
        <h2
          className="text-lg font-semibold tracking-tight outline-none"
          id="published-heading"
          ref={listHeading}
          tabIndex={-1}
        >
          Published
        </h2>
        <SectionErrorBoundary action="show your posts">
          <MyPostList
            onDeleted={() => {
              announce('Post deleted.')
              listHeading.current?.focus()
            }}
            onUpdated={() => announce('Post saved.')}
          />
        </SectionErrorBoundary>
      </section>
      <output className="sr-only">
        <span key={status.id}>{status.text}</span>
      </output>
    </Page>
  )
}
