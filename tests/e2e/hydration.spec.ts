import { POST_MAX_LENGTH } from '#/contract/limits.ts'
import { expect, signIn, test, visit } from './support/app.ts'

const TYPED = 'typed the moment the page said it was hydrated'

test('text typed the moment the page reports hydration reaches the form', async ({ author, page }) => {
  await page.addInitScript((text) => {
    new MutationObserver((_, observer) => {
      const field = document.querySelector<HTMLTextAreaElement>('#post-body')
      if (document.body.dataset.hydrated !== 'true' || !field) {
        return
      }
      observer.disconnect()
      field.focus()
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(field, text)
      field.dispatchEvent(new InputEvent('input', { bubbles: true, data: text, inputType: 'insertText' }))
    }).observe(document, { attributeFilter: ['data-hydrated'], attributes: true, subtree: true })
  }, TYPED)
  await signIn(page, author)
  await visit(page, '/dashboard')
  await expect(page.getByLabel('New post')).toHaveValue(TYPED)
  await expect(page.getByText(`${TYPED.length}/${POST_MAX_LENGTH}`)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Publish' })).toBeEnabled()
})
