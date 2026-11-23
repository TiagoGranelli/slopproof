import { HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { Route } from '#/routes/_authed/dashboard.tsx'
import { api, held, listPage, post, worker } from './api-mocks.ts'
import { pressAndKeepFocus, renderInApp } from './test-utils.tsx'

const renderDashboard = () => renderInApp(null, { route: { path: '/dashboard', route: Route }, url: '/dashboard' })
const loadMore = () => page.getByRole('button', { name: /^Load(ing)? more posts/ })
const edit = (body: string) => page.getByRole('button', { name: `Edit post: ${body}` })
const draft = () => page.getByRole('textbox', { name: 'Edit post' })
const save = () => page.getByRole('button', { exact: true, name: 'Save' })
const items = () => page.getByTestId('my-posts').getByRole('listitem')

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
