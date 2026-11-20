import type { APIRequestContext, Page } from '@playwright/test'
import { APP_NAME } from '#/config/app.ts'
import { expectAccessible } from './support/a11y.ts'
import {
  dashboardWithMyPost,
  expect,
  failServerFunctionPosts,
  lastPage,
  navigateWithApiResponse,
  overTheLimit,
  seedPost,
  signIn,
  test,
  visit,
  type Author,
} from './support/app.ts'

type Fixtures = { author: Author; page: Page; request: APIRequestContext }

const STATES = {
  about: async ({ page }) => {
    await visit(page, '/about')
  },
  account: async ({ author, page }) => {
    await signIn(page, author)
    await visit(page, '/account')
    await expect(page.getByTestId('sessions').getByRole('listitem')).not.toHaveCount(0)
  },
  'account, wrong current password': async ({ author, page }) => {
    await signIn(page, author)
    await visit(page, '/account')
    await page.getByLabel('Current password').fill('not the password at all')
    await page.getByLabel('New password').fill(`pw-${crypto.randomUUID()}`)
    await page.getByRole('button', { name: 'Change password' }).click()
    await expect(page.getByLabel('Current password')).toHaveAttribute('aria-invalid', 'true')
  },
  'dashboard, composer over the limit': async ({ author, page }) => {
    await signIn(page, author)
    await visit(page, '/dashboard')
    await page.getByLabel('New post').fill(overTheLimit)
    await expect(page.getByText('Over the 280-character limit.')).toBeAttached()
  },
  'dashboard, dark theme chosen': async ({ author, page }) => {
    await dashboardWithMyPost(page, author)
    await page.getByRole('radio', { name: 'Dark' }).check()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  },
  'dashboard, delete dialog open': async ({ author, page }) => {
    const { post } = await dashboardWithMyPost(page, author)
    await post.getByRole('button', { name: /^Delete post/ }).click()
    await expect(page.getByRole('alertdialog', { name: 'Delete this post?' })).toBeVisible()
  },
  'dashboard, editing a post': async ({ author, page }) => {
    const { edit } = await dashboardWithMyPost(page, author)
    await edit.click()
    await expect(page.getByLabel('Edit post')).toBeFocused()
  },
  'dashboard, no posts yet': async ({ author, page }) => {
    await signIn(page, author)
    await navigateWithApiResponse(page, '/api/me/posts', { json: lastPage() })
    await expect(page.getByText('You have not published anything yet.')).toBeVisible()
  },
  'dashboard, publish rejected': async ({ author, page }) => {
    await signIn(page, author)
    await visit(page, '/dashboard')
    await page.getByLabel('New post').fill(overTheLimit)
    await page.getByRole('button', { name: 'Publish' }).click()
    await expect(page.getByRole('alert')).toContainText('Use at most 280 characters')
  },
  'dashboard, save rejected': async ({ author, page }) => {
    const { edit } = await dashboardWithMyPost(page, author)
    await edit.click()
    await page.getByLabel('Edit post').fill(overTheLimit)
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByRole('alert')).toContainText('Use at most 280 characters')
  },
  'dashboard, sign-out failed': async ({ author, page }) => {
    await signIn(page, author)
    await visit(page, '/dashboard')
    await failServerFunctionPosts(page)
    await page.getByRole('button', { name: 'Sign out' }).click()
    await expect(page.getByRole('alert')).toContainText('Could not sign out')
  },
  'dashboard with posts': async ({ author, page }) => {
    await dashboardWithMyPost(page, author)
  },
  'error page': async ({ page }) => {
    await navigateWithApiResponse(page, '/api/posts', {
      json: { _tag: 'ServiceUnavailable', message: 'Database unavailable' },
      status: 503,
    })
    await expect(page.getByRole('heading', { name: 'This page could not be loaded' })).toBeVisible()
  },
  'forgot password': async ({ page }) => {
    await visit(page, '/forgot-password')
  },
  'home, flash message after signing out': async ({ author, page }) => {
    await signIn(page, author)
    await visit(page, '/dashboard')
    await page.getByRole('button', { name: 'Sign out' }).click()
    await expect(page.getByTestId('flash')).toHaveText('You are signed out.')
  },
  'home, loading': async ({ page }) => {
    await visit(page, '/about')
    await page.route('**/api/posts', () => {})
    await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: APP_NAME }).click()
    await expect(page.getByText('Loading…')).toBeVisible()
  },
  'home, no posts yet': async ({ page }) => {
    await navigateWithApiResponse(page, '/api/posts', { json: lastPage() })
    await expect(page.getByText('No posts yet.')).toBeVisible()
  },
  'home, system dark theme': async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' })
    await visit(page, '/')
  },
  'home with posts': async ({ author, page, request }) => {
    const { body } = await seedPost(request, author)
    await visit(page, '/')
    await expect(page.getByTestId('public-posts').locator(':scope > li').filter({ hasText: body })).toBeVisible()
  },
  login: async ({ page }) => {
    await visit(page, '/login')
  },
  'login, failed sign-in': async ({ page }) => {
    await visit(page, '/login')
    await page.getByRole('textbox', { exact: true, name: 'Email' }).fill('nobody@example.test')
    await page.getByLabel('Password').fill('not the password at all')
    await page.getByRole('button', { name: 'Sign in' }).click()
    await expect(page.getByRole('alert')).toBeVisible()
  },
  'not found': async ({ page }) => {
    await visit(page, '/no-such-page')
    await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible()
  },
  'reset password, invalid link': async ({ page }) => {
    await visit(page, '/reset-password?token=not-a-token')
    await page.getByLabel('New password').fill(`pw-${crypto.randomUUID()}`)
    await page.getByRole('button', { name: 'Set new password' }).click()
    await expect(page.getByRole('alert')).toContainText('This link is invalid or has expired')
  },
  'reset password, no link': async ({ page }) => {
    await visit(page, '/reset-password')
    await expect(page.getByRole('link', { name: 'Ask for a new one' })).toBeVisible()
  },
  'sign-up': async ({ page }) => {
    await visit(page, '/sign-up')
  },
  'sign-up, sent': async ({ page }) => {
    await visit(page, '/sign-up')
    await page.getByLabel('Name').fill('A11y Account')
    await page.getByRole('textbox', { exact: true, name: 'Email' }).fill(`a11y-${crypto.randomUUID()}@example.test`)
    await page.getByLabel('Password').fill(`pw-${crypto.randomUUID()}`)
    await page.getByRole('button', { name: 'Create account' }).click()
    await expect(page.getByRole('status')).toContainText('Check your inbox')
  },
  'verify email, invalid link': async ({ page }) => {
    await visit(page, '/verify-email?token=not-a-token')
    await page.getByRole('button', { name: 'Confirm email' }).click()
    await expect(page.getByRole('alert')).toContainText('This link is invalid or has expired')
  },
  'verify email, link': async ({ page }) => {
    await visit(page, '/verify-email?token=not-a-token')
    await expect(page.getByRole('button', { name: 'Confirm email' })).toBeEnabled()
  },
} satisfies Record<string, (fixtures: Fixtures) => Promise<void>>

test.describe('axe', () => {
  for (const [state, reach] of Object.entries(STATES)) {
    test(state, async ({ author, page, request }) => {
      await reach({ author, page, request })
      await expectAccessible(page, state)
    })
  }
})
