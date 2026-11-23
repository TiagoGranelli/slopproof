import { onlineManager } from '@tanstack/react-query'
import { HttpResponse } from 'msw'
import { describe, expect, it, onTestFinished } from 'vitest'
import { page } from 'vitest/browser'
import { getMyPostsQueryOptions } from '#/features/posts/api/get-my-posts.ts'
import { Route } from '#/routes/_authed/dashboard.tsx'
import { api, held, listPage, post, worker } from './api-mocks.ts'
import { afterRendering, pressAndKeepFocus, renderInApp } from './test-utils.tsx'

const renderDashboard = () => renderInApp(null, { route: { path: '/dashboard', route: Route }, url: '/dashboard' })
const loadMore = () => page.getByRole('button', { name: /^(Load(ing)? more|Refreshing) posts/ })
const edit = (body: string) => page.getByRole('button', { name: `Edit post: ${body}` })
const draft = () => page.getByRole('textbox', { name: 'Edit post' })
const save = () => page.getByRole('button', { exact: true, name: 'Save' })
const items = () => page.getByTestId('my-posts').getByRole('listitem')
const clickLoadMore = () => (loadMore().element() as HTMLButtonElement).click()

const publish = async (body: string) => {
  await page.getByRole('textbox', { name: 'New post' }).fill(body)
  await page.getByRole('button', { exact: true, name: 'Publish' }).click()
  await expect.element(page.getByRole('status')).toHaveTextContent('Post published.')
}

const mockPublishingAcrossPageBoundary = () => {
  const original = Array.from({ length: 20 }, (_, index) => post({ body: `Post ${index + 1}` }))
  const published = post({ body: 'Just published' })
  const olderPage = listPage(original.slice(-1))
  const pendingFailure = held()
  let created = false
  let nextPageRequests = 0
  worker.use(
    api.myPostsCreate(() => {
      created = true
      return HttpResponse.json(published)
    }),
    api.myPostsList(async ({ request }) => {
      if (new URL(request.url).searchParams.has('cursor')) {
        if (++nextPageRequests === 1) {
          await pendingFailure.wait()
          return HttpResponse.error()
        }
        return HttpResponse.json(olderPage)
      }
      return HttpResponse.json(created ? listPage([published, ...original.slice(0, -1)], 'older') : listPage(original))
    }),
  )
  return pendingFailure
}

const mockPublishingDuringLoad = (refreshSucceeds = false, onPublish?: () => void) => {
  const nextPage = held()
  const refresh = held()
  const nextPageStarted = Promise.withResolvers<undefined>()
  const refreshStarted = Promise.withResolvers<undefined>()
  const firstPage = listPage([post({ body: 'Newest post' })], 'old-cursor')
  const publishedPost = post({ body: 'Just published' })
  const refreshedPage = listPage([publishedPost, ...firstPage.items], 'new-cursor')
  const cursors: Array<string> = []
  let listed = false
  worker.use(
    api.myPostsCreate(() => {
      onPublish?.()
      return HttpResponse.json(publishedPost)
    }),
    api.myPostsList(async ({ request }) => {
      const cursor = new URL(request.url).searchParams.get('cursor')
      if (cursor !== null) {
        cursors.push(cursor)
      }
      if (cursor === 'new-cursor') {
        return HttpResponse.json(listPage([post({ body: 'Older post' })]))
      }
      if (cursor === 'old-cursor') {
        nextPageStarted.resolve(undefined)
        await nextPage.wait()
        return HttpResponse.json(listPage([post({ body: 'Stale page' })]))
      }
      if (listed) {
        refreshStarted.resolve(undefined)
        await refresh.wait()
        return refreshSucceeds ? HttpResponse.json(refreshedPage) : HttpResponse.error()
      }
      listed = true
      return HttpResponse.json(firstPage)
    }),
  )
  return {
    cursors,
    nextPage,
    nextPageStarted: nextPageStarted.promise,
    refresh,
    refreshStarted: refreshStarted.promise,
  }
}

const mockOverlappingSaves = (original: ReturnType<typeof post>) => {
  const firstSave = held()
  const secondSave = held()
  const firstUpdate = { ...original, body: 'Cancelled edit' }
  const secondUpdate = { ...original, body: 'Replacement draft' }
  worker.use(
    api.myPostsList({ body: listPage([original]) }),
    api.myPostsUpdate(async ({ request }) => {
      const payload = (await request.json()) as { body: string }
      const first = payload.body === firstUpdate.body
      await (first ? firstSave : secondSave).wait()
      return HttpResponse.json(first ? firstUpdate : secondUpdate)
    }),
  )
  return { firstSave, firstUpdate, secondSave, secondUpdate }
}

const saveDraft = async (posted: string, revised: string) => {
  await edit(posted).click()
  await draft().fill(revised)
  await save().click()
}

describe('dashboard posts', () => {
  it('loads, reports a failure and focuses the final post on retry after publishing opens another page', async () => {
    const pendingFailure = mockPublishingAcrossPageBoundary()
    await renderDashboard()
    await expect.element(items().nth(19)).toMatchTextContent(/^Post 20/)
    await expect.element(loadMore()).not.toBeInTheDocument()
    await publish('Just published')
    await expect.element(loadMore()).toBeVisible()
    await pressAndKeepFocus(loadMore())
    await expect.element(loadMore()).toHaveTextContent('Loading more posts…')
    pendingFailure.release()
    await expect.element(page.getByRole('alert')).toMatchTextContent(/^Could not load more posts\./)
    await expect.element(loadMore()).toHaveFocus()
    await loadMore().click()
    await expect.element(items().nth(20)).toMatchTextContent(/^Post 20/)
    await expect.element(items().nth(20)).toHaveFocus()
    await expect.element(loadMore()).not.toBeInTheDocument()
  })

  it('clears Load more when publishing cancels its request and keeps refresh failures out of it', async () => {
    const { nextPage, refresh, refreshStarted } = mockPublishingDuringLoad()
    const { queryClient } = await renderDashboard()
    await pressAndKeepFocus(loadMore())
    await publish('Just published')
    await refreshStarted
    await afterRendering()
    await expect.element(loadMore()).toHaveAttribute('aria-disabled', 'true')
    refresh.release()
    await expect.poll(() => queryClient.isFetching()).toBe(0)
    await afterRendering()
    await expect.element(loadMore()).toBeEnabled()
    expect.soft(page.getByRole('alert').elements()).toHaveLength(0)
    await expect.element(items().nth(0)).toMatchTextContent(/^Newest post/)
    await expect.element(items().nth(0)).not.toHaveFocus()
    nextPage.release()
  })

  it('waits for a publish refresh before loading more from the refreshed cursor', async () => {
    const { nextPage, nextPageStarted, refresh, refreshStarted } = mockPublishingDuringLoad(true)
    await renderDashboard()
    await Promise.all([pressAndKeepFocus(loadMore()), nextPageStarted])
    await publish('Just published')
    await refreshStarted
    await expect.element(loadMore()).toBeDisabled()
    clickLoadMore()
    await expect.element(items().nth(0)).toMatchTextContent(/^Newest post/)
    refresh.release()
    nextPage.release()
    await expect.element(items().nth(0)).toMatchTextContent(/^Just published/)
    await expect.element(items().nth(2)).not.toBeInTheDocument()
    await loadMore().click()
    await expect.element(items().nth(2)).toHaveFocus()
  })

  it('keeps the publish refresh paused offline and shows the new post on reconnect', async () => {
    const { cursors, nextPage, refresh } = mockPublishingDuringLoad(true, () => onlineManager.setOnline(false))
    const { queryClient } = await renderDashboard()
    const queryKey = getMyPostsQueryOptions().queryKey
    const wasOnline = onlineManager.isOnline()
    onTestFinished(() => onlineManager.setOnline(wasOnline))
    nextPage.release()
    refresh.release()

    await publish('Just published')
    expect(queryClient.getQueryState(queryKey)?.fetchStatus).toBe('paused')
    await afterRendering()
    expect.soft(loadMore().element()).toHaveAttribute('aria-disabled', 'true')
    clickLoadMore()
    onlineManager.setOnline(true)
    await expect.element(items().nth(0)).toMatchTextContent(/^Just published/)
    expect(cursors).toEqual([])
  })

  it('keeps the published post on return without paginating after leaving during the refresh', async () => {
    const { cursors, nextPage, nextPageStarted, refresh, refreshStarted } = mockPublishingDuringLoad(true)
    const { queryClient, router } = await renderDashboard()
    await Promise.all([pressAndKeepFocus(loadMore()), nextPageStarted])
    await publish('Just published')
    await refreshStarted
    await afterRendering()
    clickLoadMore()
    await router.navigate({ to: '/about' })
    await expect.element(page.getByTestId('my-posts')).not.toBeInTheDocument()
    nextPage.release()
    refresh.release()
    await expect.poll(() => queryClient.isMutating()).toBe(0)
    await router.navigate({ to: '/dashboard' })
    expect.soft(cursors).toEqual(['old-cursor'])
    await expect.element(items().nth(0)).toMatchTextContent(/^Just published/)
  })

  it('blocks Load more during a background refresh and uses the refreshed cursor after it settles', async () => {
    const { cursors, nextPage, refresh, refreshStarted } = mockPublishingDuringLoad(true)
    const { queryClient } = await renderDashboard()
    const queryKey = getMyPostsQueryOptions().queryKey
    nextPage.release()
    await queryClient.invalidateQueries({ queryKey, refetchType: 'none' })
    const pendingRefresh = queryClient.refetchQueries({ queryKey, stale: true, type: 'active' })
    clickLoadMore()
    await refreshStarted
    await expect.element(page.getByRole('button', { name: 'Refreshing posts…' })).toBeDisabled()
    refresh.release()
    await pendingRefresh
    await expect.element(loadMore()).toBeEnabled()
    await loadMore().click()
    await expect.element(items().nth(2)).toHaveFocus()
    expect(cursors).toEqual(['new-cursor'])
  })

  it('announces the saved post and restores focus while the list is still refetching', async () => {
    const original = post({ body: 'Original post' })
    const updated = { ...original, body: 'Saved edit' }
    const refetch = held()
    let saved = false
    worker.use(
      api.myPostsList(async () => {
        if (saved) {
          await refetch.wait()
        }
        return HttpResponse.json(listPage([saved ? updated : original]))
      }),
      api.myPostsUpdate(() => {
        saved = true
        return HttpResponse.json(updated)
      }),
    )
    const { queryClient } = await renderDashboard()
    await saveDraft(original.body, updated.body)
    await expect.poll(() => queryClient.isFetching()).toBe(1)
    await expect.element(draft()).not.toBeInTheDocument()
    await expect.element(edit(updated.body)).toHaveFocus()
    await expect.element(page.getByRole('status')).toHaveTextContent('Post saved.')
    expect(queryClient.isFetching()).toBe(1)
    refetch.release()
    await expect.poll(() => queryClient.isFetching()).toBe(0)
  })

  it('keeps a reopened editor saving when the cancelled editor’s request succeeds', async () => {
    const original = post({ body: 'Original post' })
    const { firstSave, firstUpdate, secondSave, secondUpdate } = mockOverlappingSaves(original)
    const { queryClient } = await renderDashboard()
    await saveDraft(original.body, firstUpdate.body)
    await expect.poll(() => queryClient.isMutating()).toBe(1)
    await page.getByRole('button', { exact: true, name: 'Cancel' }).click()
    await saveDraft(original.body, secondUpdate.body)
    await expect.poll(() => queryClient.isMutating()).toBe(2)
    firstSave.release()
    await expect.poll(() => queryClient.isMutating()).toBe(1)
    await expect.element(draft()).toHaveValue(secondUpdate.body)
    await expect.element(save()).toHaveFocus()
    await expect.element(page.getByRole('status')).not.toHaveTextContent('Post saved.')
    secondSave.release()
    await expect.element(page.getByRole('status')).toHaveTextContent('Post saved.')
  })
})
