import { describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { LoginForm } from '#/features/auth/components/login-form.tsx'
import { PostComposer } from '#/features/posts/components/post-composer.tsx'
import { renderInApp } from './test-utils.tsx'

vi.mock('#/components/form/form-schema.ts', () => ({
  get toFormSchema(): never {
    throw new TypeError('Failed to fetch dynamically imported module')
  },
}))

const SCHEMA_LOAD_FAILED = "Couldn't load the form. Check your connection and try again."
const alert = () => page.getByRole('alert').filter({ hasText: SCHEMA_LOAD_FAILED })

describe('a form whose schema cannot be loaded', () => {
  it('says so under the post composer and keeps the draft', async () => {
    await renderInApp(<PostComposer />)
    const field = page.getByLabelText('New post')
    await field.fill('a draft')
    await page.getByRole('button', { name: 'Publish' }).click()

    await expect.element(alert()).toBeVisible()
    await expect.element(field).toHaveValue('a draft')
    await expect
      .element(field)
      .toHaveAccessibleDescription(/Couldn't load the form\. Check your connection and try again\.$/)
  })

  it('says so under the sign-in form, which stays usable', async () => {
    await renderInApp(<LoginForm />, { url: '/login' })
    const signIn = page.getByRole('button', { name: 'Sign in' })
    await signIn.click()

    await expect.element(alert()).toBeVisible()
    await expect.element(signIn).toBeEnabled()
    await expect.element(signIn).not.toHaveAttribute('aria-disabled')
    const email = page.getByRole('textbox', { exact: true, name: 'Email' })
    await email.fill('author@example.test')
    await expect.element(email).toHaveValue('author@example.test')
    await signIn.click()
    await expect.element(alert()).toBeVisible()
  })
})
