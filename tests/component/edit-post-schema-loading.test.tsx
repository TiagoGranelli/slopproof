import { HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { POST_MAX_LENGTH } from '#/contract/limits.ts'
import { Route } from '#/routes/_authed/dashboard.tsx'
import { api, listPage, post, worker } from './api-mocks.ts'
import { renderInApp } from './test-utils.tsx'

const chunk = vi.hoisted(() => Promise.withResolvers<undefined>())

vi.mock('#/components/form/form-schema.ts', async (importOriginal) => {
  await chunk.promise
  return importOriginal()
})

const edit = (body: string) => page.getByRole('button', { name: `Edit post: ${body}` })
const draft = () => page.getByRole('textbox', { name: 'Edit post' })
const save = () => page.getByRole('button', { exact: true, name: 'Save' })

const submitDraft = async (original: string, body: string) => {
  await edit(original).click()
  await draft().fill(body)
  await save().click()
  await expect.element(save()).toHaveAttribute('aria-disabled', 'true')
}

const mockSave = (original: ReturnType<typeof post>, updated: ReturnType<typeof post>) => {
  let saved = false
  worker.use(
    api.myPostsList(() => HttpResponse.json(listPage([saved ? updated : original]))),
    api.myPostsUpdate(() => {
      saved = true
      return HttpResponse.json(updated)
    }),
  )
}

describe('editing posts while the form schema loads', () => {
  it('closes the replacement editor and restores focus after the cancelled draft would fail validation', async () => {
    const original = post({ body: 'Original post' })
    const updated = { ...original, body: 'Replacement draft' }
    mockSave(original, updated)
    await renderInApp(null, { route: { path: '/dashboard', route: Route }, url: '/dashboard' })
    await submitDraft(original.body, 'x'.repeat(POST_MAX_LENGTH + 1))
    await page.getByRole('button', { exact: true, name: 'Cancel' }).click()
    await submitDraft(original.body, updated.body)
    chunk.resolve(undefined)
    await expect.element(page.getByRole('status')).toHaveTextContent('Post saved.')
    await expect.element(draft()).not.toBeInTheDocument()
    await expect.element(edit(updated.body)).toHaveFocus()
  })
})
