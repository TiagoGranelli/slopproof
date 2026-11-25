import { HttpResponse } from 'msw'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { page } from 'vitest/browser'
import { getMyPostsQueryOptions } from '#/features/posts/api/get-my-posts.ts'
import { Route } from '#/routes/_authed/dashboard.tsx'
import { api, held, listPage, post, worker } from './api-mocks.ts'
import { renderInApp } from './test-utils.tsx'

const renderDashboard = () => renderInApp(null, { route: { path: '/dashboard', route: Route }, url: '/dashboard' })
const loadMore = () => page.getByRole('button', { name: /^(?:Load(?:ing)? more|Refreshing) posts/ })
const makePosts = (count: number) => Array.from({ length: count }, (_, index) => post({ body: `Post ${index + 1}` }))
const unauthorizedResponse = () =>
  HttpResponse.json({ _tag: 'Unauthorized', message: 'Authentication required' }, { status: 401 })
const SESSION_ENDED_TEXT = 'Your session has ended. Sign in again to continue. Sign in'

const startPendingPublish = async (queryClient: { isMutating: () => number }, body: string) => {
  await page.getByRole('textbox', { name: 'New post' }).fill(body)
  await page.getByRole('button', { exact: true, name: 'Publish' }).click()
  await expect.poll(() => queryClient.isMutating()).toBe(1)
}

const setupSupersededRetry = () => {
  const posts = makePosts(20)
  const publishedPost = post({ body: 'Just published' })
  const publishGate = held()
  const retryRefresh = held()
  const retryStarted = Promise.withResolvers<undefined>()
  const state = { expired: false, initialLoaded: false, networkDown: false, retryHeld: false }
  worker.use(
    api.myPostsCreate(async () => {
      await publishGate.wait()
      return HttpResponse.json(publishedPost)
    }),
    api.myPostsList(async ({ request }) => {
      if (new URL(request.url).searchParams.has('cursor')) {
        return state.expired ? unauthorizedResponse() : HttpResponse.json(listPage([]))
      }
      if (state.networkDown) {
        return HttpResponse.error()
      }
      if (state.initialLoaded && !state.retryHeld) {
        state.retryHeld = true
        retryStarted.resolve(undefined)
        await retryRefresh.wait()
        return HttpResponse.json(listPage(posts, 'older'))
      }
      state.initialLoaded = true
      return HttpResponse.json(listPage(posts, 'older'))
    }),
  )
  return { publishGate, retryRefresh, retryStarted, state }
}

const setupSlowOfflineRefresh = () => {
  const posts = makePosts(20)
  const refreshGate = held()
  const refreshStarted = Promise.withResolvers<undefined>()
  const state = { holdRefresh: false }
  worker.use(
    api.myPostsList(async ({ request }) => {
      if (new URL(request.url).searchParams.has('cursor')) {
        return unauthorizedResponse()
      }
      if (state.holdRefresh) {
        refreshStarted.resolve(undefined)
        await refreshGate.wait()
        return HttpResponse.error()
      }
      return HttpResponse.json(listPage(posts, 'older'))
    }),
  )
  return { refreshGate, refreshStarted, state }
}

const focusVisibleLink = async (link: ReturnType<typeof page.getByRole>) => {
  await expect.element(link).toBeVisible()
  ;(link.element() as HTMLElement).focus()
  await expect.element(link).toHaveFocus()
}

const expectSignInFocused = async (link: ReturnType<typeof page.getByRole>) => {
  await expect.element(link).toBeVisible()
  await expect.element(link).toHaveFocus()
}

describe('dashboard Load more errors', () => {
  it('keeps the sign-in prompt from Load more when a background refresh then fails offline', async () => {
    const posts = makePosts(20)
    let networkDown = false
    worker.use(
      api.myPostsList(({ request }) => {
        if (networkDown) {
          return HttpResponse.error()
        }
        if (new URL(request.url).searchParams.has('cursor')) {
          return unauthorizedResponse()
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
    await expect.element(alert).toHaveTextContent(SESSION_ENDED_TEXT)
  })

  it('keeps the 401 prompt when a slow publish supersedes a Load more retry and fails offline', async () => {
    const { publishGate, retryRefresh, retryStarted, state } = setupSupersededRetry()
    const { queryClient } = await renderDashboard()
    await startPendingPublish(queryClient, 'Just published')
    state.expired = true
    await loadMore().click()
    await expect.element(page.getByRole('alert').getByRole('link', { name: 'Sign in' })).toBeInTheDocument()
    await loadMore().click()
    await retryStarted.promise
    state.networkDown = true
    publishGate.release()
    await expect.poll(() => queryClient.isMutating()).toBe(0)
    await expect.element(loadMore()).toBeEnabled()
    retryRefresh.release()
    await expect.element(page.getByRole('alert')).toHaveTextContent(SESSION_ENDED_TEXT)
  })

  it('clears the alert when a background refetch returns identical data in the same millisecond', async () => {
    const posts = makePosts(20)
    worker.use(
      api.myPostsList(({ request }) =>
        new URL(request.url).searchParams.has('cursor')
          ? unauthorizedResponse()
          : HttpResponse.json(listPage(posts, 'older')),
      ),
    )
    const { queryClient } = await renderDashboard()
    const alert = page.getByRole('alert')
    await loadMore().click()
    await expect.element(alert.getByRole('link', { name: 'Sign in' })).toBeInTheDocument()
    const { queryKey } = getMyPostsQueryOptions()
    const cachedUpdatedAt = queryClient.getQueryState(queryKey)!.dataUpdatedAt
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(cachedUpdatedAt)
    onTestFinished(() => nowSpy.mockRestore())
    await queryClient.refetchQueries({ queryKey })
    await expect.element(loadMore()).toBeEnabled()
    await expect.element(alert).not.toBeInTheDocument()
  })

  it('keeps the Sign in link visible and focused while a background refresh is pending and after it fails', async () => {
    const { refreshGate, refreshStarted, state } = setupSlowOfflineRefresh()
    const { queryClient } = await renderDashboard()
    await loadMore().click()
    const signInLink = page.getByRole('alert').getByRole('link', { name: 'Sign in' })
    await focusVisibleLink(signInLink)
    state.holdRefresh = true
    const pendingRefresh = queryClient.refetchQueries({ queryKey: getMyPostsQueryOptions().queryKey })
    await refreshStarted.promise
    await expect.element(loadMore()).toHaveAttribute('aria-disabled', 'true')
    await expectSignInFocused(signInLink)
    refreshGate.release()
    await pendingRefresh
    await expect.element(loadMore()).toBeEnabled()
    await expectSignInFocused(signInLink)
  })
})
