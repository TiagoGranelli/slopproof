import type { Page } from '@playwright/test'
import { APP_NAME } from '#/config/app.ts'
import { expectTabStops, tabOrder, tabThrough } from './support/a11y.ts'
import { createAccount } from './support/accounts.ts'
import {
  authenticate,
  dashboardWithMyPost,
  expect,
  fakePost,
  lastPage,
  navigateWithApiResponse,
  sharedPageTest as test,
  signIn,
  visit,
} from './support/app.ts'
import type { Author } from './support/app.ts'

test.skip(({ isMobile }) => isMobile, 'keyboard navigation is a desktop concern')

const NAV = ['link "Skip to content"', `link "${APP_NAME}"`, 'link "About"']
const SIGNED_OUT = [...NAV, 'link "Sign in"']
const SIGNED_IN = [...NAV, 'link "Dashboard"', 'link "Account"', 'button "Sign out"']
const FOOTER = ['radio "System"']

type Row = { controls: Array<string>; footer?: Array<string>; header: Array<string>; never?: Array<string> }

test.describe('tab order', () => {
  const pages: Array<[string, (page: Page, author: Author) => Promise<void>, Row]> = [
    [
      'home',
      async (page) => {
        await visit(page, '/')
      },
      { controls: ['button "Load more posts"'], header: SIGNED_OUT },
    ],
    [
      'home, flash message after signing out',
      async (page, author) => {
        await signIn(page, author)
        await visit(page, '/dashboard')
        await page.getByRole('button', { name: 'Sign out' }).click()
        await expect(page.getByTestId('flash')).toBeVisible()
      },
      { controls: ['button "Load more posts"'], header: SIGNED_OUT },
    ],
    [
      'about',
      async (page) => {
        await visit(page, '/about')
        await expect(
          page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Sign in' }),
        ).toBeVisible()
      },
      { controls: [], header: SIGNED_OUT },
    ],
    [
      'login',
      async (page) => {
        await visit(page, '/login')
      },
      {
        controls: [
          'textbox "Email"',
          'textbox "Password"',
          'button "Sign in"',
          'link "Forgot your password?"',
          'link "Create one"',
        ],
        header: SIGNED_OUT,
      },
    ],
    [
      'sign-up',
      async (page) => {
        await visit(page, '/sign-up')
      },
      {
        controls: [
          'textbox "Name"',
          'textbox "Email"',
          'textbox "Password"',
          'button "Create account"',
          'link "Sign in"',
        ],
        header: SIGNED_OUT,
      },
    ],
    [
      'forgot password',
      async (page) => {
        await visit(page, '/forgot-password')
      },
      { controls: ['textbox "Email"', 'button "Send reset link"', 'link "Back to sign in"'], header: SIGNED_OUT },
    ],
    [
      'reset password',
      async (page) => {
        await visit(page, '/reset-password?token=not-a-token')
      },
      { controls: ['textbox "New password"', 'button "Set new password"'], header: SIGNED_OUT },
    ],
    [
      'reset password, no link',
      async (page) => {
        await visit(page, '/reset-password')
      },
      { controls: ['link "Ask for a new one"'], header: SIGNED_OUT },
    ],
    [
      'verify email',
      async (page) => {
        await visit(page, '/verify-email?token=not-a-token')
      },
      { controls: ['button "Confirm email"'], header: SIGNED_OUT },
    ],
    [
      'account',
      async (page) => {
        await signIn(page, await createAccount())
        await visit(page, '/account')
      },
      {
        controls: [
          'textbox "Current password"',
          'textbox "New password"',
          'button "Change password"',
          'button "Sign out everywhere"',
          'textbox "Password"',
          'checkbox "I understand that my account and all its data are deleted for good."',
          'button "Delete account"',
        ],
        header: SIGNED_IN,
        never: ['button "Sign out other sessions"'],
      },
    ],
    [
      'not found',
      async (page) => {
        await visit(page, '/no-such-page')
      },
      { controls: ['link "Go to the home page"'], header: SIGNED_OUT },
    ],
    [
      'error page',
      async (page, author) => {
        await authenticate(page, author)
        await navigateWithApiResponse(page, '/api/posts', { json: {}, status: 503 })
        await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible()
      },
      { controls: ['button "Try again"', 'link "Go to the home page"'], header: SIGNED_IN },
    ],
    [
      'dashboard',
      async (page, author) => {
        await authenticate(page, author)
        await navigateWithApiResponse(page, '/api/me/posts', { json: lastPage(fakePost('First'), fakePost('Second')) })
        await expect(page.getByText('Second', { exact: true })).toBeVisible()
      },
      {
        controls: [
          'textbox "New post"',
          'button "Edit post: First"',
          'button "Delete post: First"',
          'button "Edit post: Second"',
          'button "Delete post: Second"',
        ],
        header: SIGNED_IN,
        never: ['button "Publish"'],
      },
    ],
    [
      'dashboard, dark theme chosen',
      async (page, author) => {
        await authenticate(page, author)
        await navigateWithApiResponse(page, '/api/me/posts', { json: lastPage(fakePost('First')) })
        await page.getByRole('radio', { name: 'Dark' }).check()
      },
      {
        controls: ['textbox "New post"', 'button "Edit post: First"', 'button "Delete post: First"'],
        footer: ['radio "Dark"'],
        header: SIGNED_IN,
      },
    ],
  ]

  for (const [name, reach, row] of pages) {
    test(`${name}: its controls in order, with visible focus, then past the last one`, async ({ author, page }) => {
      await reach(page, author)
      const { controls, footer = FOOTER, header, never } = row
      expectTabStops(await tabOrder(page), { first: header, inOrder: controls, last: footer, never })
    })
  }

  test('Shift+Tab walks the same stops backwards and past the first one', async ({ page }) => {
    await visit(page, '/login')
    await page.getByRole('button', { name: 'Sign in' }).focus()
    const stops = await tabThrough(page, { backwards: true })
    expectTabStops(stops, {
      first: [],
      inOrder: ['textbox "Password"', 'textbox "Email"'],
      last: SIGNED_OUT.toReversed(),
    })
  })
})

test.describe('focus traps', () => {
  test('the edit form is not a trap: Tab goes on to Cancel, Save and the rest of the page', async ({
    author,
    page,
  }) => {
    await authenticate(page, author)
    await navigateWithApiResponse(page, '/api/me/posts', { json: lastPage(fakePost('First'), fakePost('Second')) })
    await page.getByRole('button', { name: 'Edit post: First' }).click()
    await expect(page.getByLabel('Edit post')).toBeFocused()
    expectTabStops(await tabThrough(page), {
      first: ['button "Cancel"', 'button "Save"'],
      inOrder: ['button "Edit post: Second"', 'button "Delete post: Second"'],
      last: FOOTER,
    })
  })

  test('the delete dialog keeps Tab inside it; Escape closes it and puts focus back on Delete', async ({
    author,
    page,
  }) => {
    const { post } = await dashboardWithMyPost(page, author)
    const remove = post.getByRole('button', { name: /^Delete post/ })
    await remove.focus()
    await page.keyboard.press('Enter')
    const dialog = page.getByRole('alertdialog', { name: 'Delete this post?' })
    await expect(dialog.getByRole('button', { name: 'Keep it' })).toBeFocused()
    const stops: Array<string> = []
    for (let press = 0; press < 3; press++) {
      await page.keyboard.press('Tab')
      stops.push((await page.locator(':focus').textContent()) ?? '')
    }
    expect(stops).toEqual(['Delete', 'Keep it', 'Delete'])
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    await expect(remove).toBeFocused()
  })
})
