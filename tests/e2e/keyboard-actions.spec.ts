import { randomUUID } from 'node:crypto'
import { dashboardWithMyPost, expect, failServerFunctionPosts, signIn, test, visit } from './support/app.ts'

test.skip(({ isMobile }) => isMobile, 'keyboard navigation is a desktop concern')

test.describe('editing from the keyboard', () => {
  test('Enter on Edit focuses the draft; Escape cancels and puts focus back on Edit', async ({ author, page }) => {
    const { body, edit, post } = await dashboardWithMyPost(page, author)
    await edit.focus()
    await page.keyboard.press('Enter')
    const field = page.getByLabel('Edit post')
    await expect(field).toBeFocused()
    await page.keyboard.type(' (discarded)')
    await page.keyboard.press('Escape')
    await expect(field).toHaveCount(0)
    await expect(edit).toBeFocused()
    await expect(post.locator('p').first()).toHaveText(body)
  })

  test('Save from the keyboard announces it and returns focus to Edit', async ({ author, page }) => {
    const { body, edit } = await dashboardWithMyPost(page, author)
    await edit.focus()
    await page.keyboard.press('Enter')
    await expect(page.getByLabel('Edit post')).toBeFocused()
    await page.keyboard.type(' (saved)')
    await page.keyboard.press('Tab')
    await page.keyboard.press('Tab')
    await expect(page.getByRole('button', { name: 'Save' })).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('status')).toHaveText('Post saved.')
    const saved = page
      .getByTestId('my-posts')
      .locator(':scope > li')
      .filter({ hasText: `${body} (saved)` })
    await expect(saved.getByRole('button', { name: /^Edit/ })).toBeFocused()
  })

  test('a rejected save is an alert inside the form that also describes the draft', async ({ author, page }) => {
    const { edit } = await dashboardWithMyPost(page, author)
    await edit.click()
    const field = page.getByLabel('Edit post')
    await field.fill('x'.repeat(281))
    await page.getByRole('button', { name: 'Save' }).press('Enter')
    const alert = page.getByRole('alert')
    await expect(alert).toContainText('Use at most 280 characters')
    await expect(field).toHaveAttribute('aria-invalid', 'true')
    await expect(field).toHaveAccessibleDescription(/Over the 280-character limit\..*Use at most 280 characters/)
    await expect(field).toBeFocused()
  })
})

test.describe('announcements', () => {
  test('publishing is announced and puts focus back in the empty composer', async ({ author, page }) => {
    await dashboardWithMyPost(page, author)
    await expect(page.getByRole('status')).toHaveText('Post published.')
    await expect(page.getByLabel('New post')).toBeFocused()
    await expect(page.getByLabel('New post')).toHaveValue('')
  })

  test('deleting asks first, is announced, and then moves focus to the list heading', async ({ author, page }) => {
    const { post } = await dashboardWithMyPost(page, author)
    await post.getByRole('button', { name: /^Delete post/ }).focus()
    await page.keyboard.press('Enter')
    const dialog = page.getByRole('alertdialog', { name: 'Delete this post?' })
    await expect(dialog.getByRole('button', { name: 'Keep it' })).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(dialog.getByRole('button', { exact: true, name: 'Delete' })).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(post).toHaveCount(0)
    await expect(page.getByRole('heading', { name: 'Published' })).toBeFocused()
    await expect(page.getByRole('status')).toHaveText('Post deleted.')
  })

  test('a failed sign-in is an alert that describes the form, and focus stays in the form', async ({ page }) => {
    await visit(page, '/login')
    await page.getByRole('textbox', { exact: true, name: 'Email' }).fill('nobody@example.test')
    await page.getByLabel('Password').fill('not the password at all')
    await page.keyboard.press('Enter')
    const alert = page.getByRole('alert')
    await expect(alert).toBeVisible()
    await expect(page.locator('form')).toHaveAccessibleDescription(await alert.innerText())
    await expect(page.getByLabel('Password')).toBeFocused()
  })

  test('a failed sign-out is an alert, and the button can be used again from the keyboard', async ({
    author,
    page,
  }) => {
    await signIn(page, author)
    await visit(page, '/dashboard')
    const restore = await failServerFunctionPosts(page)
    const signOut = page.getByRole('button', { name: 'Sign out' })
    await signOut.focus()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('alert')).toHaveText('Could not sign out. Check your connection and try again.')
    await expect(signOut).toBeEnabled()
    await restore()
    await signOut.focus()
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(/\/$/)
  })
})

test('Sign out on the home page moves focus to the page heading, not to <body>', async ({ author, page }) => {
  await signIn(page, author)
  await visit(page, '/')
  const signOut = page.getByRole('button', { name: 'Sign out' })
  await signOut.focus()
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('flash')).toHaveText('You are signed out.')
  await expect(page.getByRole('heading', { level: 1 })).toBeFocused()
})

test('a post with a supplementary Unicode character at index 39 keeps well-formed button labels', async ({
  author,
  page,
}) => {
  await signIn(page, author)
  await visit(page, '/dashboard')
  const body = `${'a'.repeat(39)}🀀 ${randomUUID()}`
  await page.getByLabel('New post').fill(body)
  await page.getByRole('button', { name: 'Publish' }).click()
  const post = page.getByTestId('my-posts').locator(':scope > li').filter({ hasText: body })
  await expect(post).toBeVisible()
  const labels = await post.getByRole('button').evaluateAll((buttons) => buttons.map((button) => button.textContent))
  expect(labels.length).toBeGreaterThanOrEqual(2)
  for (const label of labels) {
    expect(label.isWellFormed()).toBe(true)
  }
})

test('clicking the dimmed backdrop of the delete dialog keeps focus inside the dialog', async ({ author, page }) => {
  const { post } = await dashboardWithMyPost(page, author)
  await post.getByRole('button', { name: /^Delete post:/ }).click()
  const dialog = page.getByRole('alertdialog', { name: 'Delete this post?' })
  await expect(dialog.getByRole('button', { name: 'Keep it' })).toBeFocused()
  await page.mouse.click(10, 10)
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Keep it' })).toBeFocused()
  expect(await page.evaluate(() => document.activeElement === document.body)).toBe(false)
})

test('Sign out from /about after visiting / keeps a single h1 and never drops focus to <body>', async ({
  author,
  page,
}) => {
  await signIn(page, author)
  await visit(page, '/')
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { exact: true, name: 'About' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'About' })).toBeVisible()
  const started = Promise.withResolvers<undefined>()
  const gate = Promise.withResolvers<undefined>()
  await page.route('**/api/posts**', async (route) => {
    started.resolve(undefined)
    await gate.promise
    await route.continue()
  })
  await page.getByRole('button', { name: 'Sign out' }).click()
  await started.promise
  const stateDuringLoad = await page.evaluate(() => ({
    activeTag: document.activeElement?.tagName.toLowerCase(),
    h1Count: document.querySelectorAll('h1').length,
  }))
  gate.resolve(undefined)
  expect(stateDuringLoad.h1Count).toBe(1)
  expect(stateDuringLoad.activeTag).not.toBe('body')
  await expect(page.getByRole('heading', { level: 1, name: 'Latest posts' })).toBeFocused()
})
