import * as fc from 'fast-check'
import { HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { MyPost } from '#/features/posts/components/my-post.tsx'
import { api, post, worker } from './api-mocks.ts'
import { renderInApp } from './test-utils.tsx'

interface RenderedEditorModel {
  draft: string
  lastOutcome: 'failed' | 'none'
  open: boolean
  savedBody: string
}

interface RenderedEditorReal {
  nextOutcome: 'fail' | 'succeed'
  requests: number
}

const editButton = () => page.getByRole('button', { name: /^Edit/ })
const field = () => page.getByLabelText('Edit post')
const saveButton = () => page.getByRole('button', { name: 'Save' })
const cancelButton = () => page.getByRole('button', { name: 'Cancel' })

const runOpenEditor = async (model: RenderedEditorModel) => {
  await editButton().click()
  await expect.element(field()).toHaveFocus()
  await expect.element(field()).toHaveValue(model.savedBody)
  model.open = true
  model.draft = model.savedBody
  model.lastOutcome = 'none'
}

const runTypeDraft = async (model: RenderedEditorModel, text: string) => {
  await field().fill(text)
  await expect.element(field()).toHaveValue(text)
  model.draft = text
}

const runCancelEditor = async (model: RenderedEditorModel, via: 'button' | 'escape') => {
  if (via === 'button') {
    await cancelButton().click()
  } else {
    await field().click()
    await userEvent.keyboard('{Escape}')
  }
  await expect.element(field()).not.toBeInTheDocument()
  await expect.element(editButton()).toHaveFocus()
  await expect.element(page.getByText(model.savedBody, { exact: true })).toBeVisible()
  model.open = false
  model.draft = model.savedBody
  model.lastOutcome = 'none'
}

const runSaveFail = async (model: RenderedEditorModel, real: RenderedEditorReal) => {
  const before = real.requests
  real.nextOutcome = 'fail'
  await saveButton().click()
  await expect.element(page.getByRole('alert')).toBeVisible()
  await expect.element(field()).toHaveValue(model.draft)
  expect(real.requests).toBe(before + 1)
  model.lastOutcome = 'failed'
}

const runSaveSucceed = async (model: RenderedEditorModel, real: RenderedEditorReal) => {
  const before = real.requests
  real.nextOutcome = 'succeed'
  await saveButton().click()
  await expect.element(field()).not.toBeInTheDocument()
  await expect.element(editButton()).toHaveFocus()
  expect(real.requests).toBe(before + 1)
  model.open = false
  model.lastOutcome = 'none'
  model.draft = model.savedBody
}

const openCommand: fc.AsyncCommand<RenderedEditorModel, RenderedEditorReal> = {
  check: (model) => !model.open,
  run: (model) => runOpenEditor(model),
  toString: () => 'click(Edit)',
}

const typeCommand = (text: string): fc.AsyncCommand<RenderedEditorModel, RenderedEditorReal> => ({
  check: (model) => model.open,
  run: (model) => runTypeDraft(model, text),
  toString: () => `fill(${JSON.stringify(text)})`,
})

const cancelCommand = (via: 'button' | 'escape'): fc.AsyncCommand<RenderedEditorModel, RenderedEditorReal> => ({
  check: (model) => model.open,
  run: (model) => runCancelEditor(model, via),
  toString: () => `cancel(${via})`,
})

const saveFailCommand: fc.AsyncCommand<RenderedEditorModel, RenderedEditorReal> = {
  check: (model) => model.open && model.draft.trim().length > 0,
  run: (model, real) => runSaveFail(model, real),
  toString: () => 'save(fail)',
}

const saveSucceedCommand: fc.AsyncCommand<RenderedEditorModel, RenderedEditorReal> = {
  check: (model) => model.open && model.draft.trim().length > 0,
  run: (model, real) => runSaveSucceed(model, real),
  toString: () => 'save(succeed)',
}

const editorCommands = fc.commands(
  [
    fc.constant(openCommand),
    fc.constantFrom('First draft', 'Revised body', 'Another edit').map((text) => typeCommand(text)),
    fc.constantFrom('button' as const, 'escape' as const).map((via) => cancelCommand(via)),
    fc.constant(saveFailCommand),
    fc.constant(saveSucceedCommand),
  ],
  { maxCommands: 6 },
)

describe('MyPost property-based UI invariants', () => {
  it('preserves draft, focus return and single-submit invariants across random interaction sequences', async () => {
    await fc.assert(
      fc.asyncProperty(editorCommands, async (commands) => {
        const original = post({ body: 'Original post body' })
        const real: RenderedEditorReal = { nextOutcome: 'succeed', requests: 0 }
        worker.use(
          api.myPostsUpdate(async ({ request }) => {
            real.requests++
            const payload = (await request.json()) as { body: string }
            return real.nextOutcome === 'fail'
              ? HttpResponse.error()
              : HttpResponse.json({ ...original, body: payload.body })
          }),
        )
        const rendered = await renderInApp(<MyPost post={original} />)
        const model: RenderedEditorModel = {
          draft: original.body,
          lastOutcome: 'none',
          open: false,
          savedBody: original.body,
        }
        await fc.asyncModelRun(() => ({ model, real }), commands)
        expect(real.requests).toBeGreaterThanOrEqual(0)
        await rendered.unmount()
      }),
      { numRuns: 5 },
    )
  })
})
