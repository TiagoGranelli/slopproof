import { HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { getMyPostsQueryOptions } from '#/features/posts/api/get-my-posts.ts'
import { Route } from '#/routes/_authed/dashboard.tsx'
import { api, listPage, post, worker } from './api-mocks.ts'
import { renderInApp } from './test-utils.tsx'

const renderDashboard = () => renderInApp(null, { route: { path: '/dashboard', route: Route }, url: '/dashboard' })
const loadMore = () => page.getByRole('button', { name: /^(?:Load(?:ing)? more|Refreshing) posts/ })

describe('dashboard Load more errors', () => {
  it('keeps the sign-in prompt from Load more when a background refresh then fails offline', async () => {
    const posts = Array.from({ length: 20 }, (_, index) => post({ body: `Post ${index + 1}` }))
    let networkDown = false
    worker.use(
      api.myPostsList(({ request }) => {
        if (networkDown) {
          return HttpResponse.error()
        }
        if (new URL(request.url).searchParams.has('cursor')) {
          return HttpResponse.json({ _tag: 'Unauthorized', message: 'Authentication required' }, { status: 401 })
        }
        return HttpResponse.json(listPage(posts, 'older'))
      }),
    )
    const { queryClient } = await renderDashboard()
    const alert = page.getByRole('alert')

    await loadMore().click()
    await expect.element(alert.getByRole('link', { name: 'Sign in' })).toBeInTheDocument()
    networkDown = true
    await queryClient.refetchQueries({ queryKey: getMyPostsQueryOptions().queryKey })
    await expect.element(loadMore()).toBeEnabled()
    await expect.element(alert).toHaveTextContent('Your session has ended. Sign in again to continue. Sign in')
  })
})
