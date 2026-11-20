import type { Page } from '@playwright/test'
import { APP_NAME } from '#/config/app.ts'
import { dashboardWithMyPost, expect, expectHydrated, signIn, test, visit } from './support/app.ts'

const navLink = (page: Page, name: string) =>
  page.getByRole('navigation', { name: 'Main' }).getByRole('link', { exact: true, name })

const expectHome = async (page: Page) => {
  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
}

test('blocks and reports markup injected into a page', async ({ cspViolations, page }) => {
  await page.route('/', async (route) => {
    const response = await route.fetch({ headers: { ...route.request().headers(), 'accept-encoding': 'gzip' } })
    const injected = '<script>window.injected = true</script><style>body { color: red }</style>'
    const { 'content-encoding': _encoding, 'content-length': _length, ...headers } = response.headers()
    await route.fulfill({
      body: (await response.text()).replace('</main>', `${injected}</main>`),
      headers,
      response,
    })
  })
  await visit(page, '/')
  await expect
    .poll(() => cspViolations.map((v) => v.directive).toSorted())
    .toEqual(['script-src-elem', 'style-src-elem'])
  expect(await page.evaluate(() => 'injected' in window)).toBe(false)
  cspViolations.length = 0
})

test('SSR pages load every module and route chunk under the nonce policy', async ({ author, page }) => {
  const response = await visit(page, '/')
  expect(response?.headers()['content-security-policy']).toContain("'strict-dynamic'")
  await navLink(page, 'About').click()
  await expect(page.getByRole('heading', { name: 'About' })).toBeVisible()
  await navLink(page, 'Sign in').click()
  await expect(page).toHaveURL(/\/login$/)
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeEnabled()

  await signIn(page, author)
  await visit(page, '/dashboard')
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible()
  await navLink(page, APP_NAME).click()
  await expectHome(page)

  const missing = await visit(page, '/no-such-page')
  expect(missing?.status()).toBe(404)
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible()
})

test('the prerendered page runs under its hash policy and navigates on', async ({ page }) => {
  const response = await visit(page, '/about')
  const csp = response?.headers()['content-security-policy'] ?? ''
  expect(csp).toContain("'sha256-")
  expect(csp).not.toContain("'nonce-")
  await navLink(page, APP_NAME).click()
  await expectHome(page)
  await navLink(page, 'About').click()
  await expect(page.getByRole('heading', { name: 'About' })).toBeVisible()
})

test('opening a delete dialog after returning from a reloaded prerendered page triggers no CSP violation', async ({
  author,
  page,
}) => {
  const { post } = await dashboardWithMyPost(page, author)
  await navLink(page, 'About').click()
  await expect(page.getByRole('heading', { level: 1, name: 'About' })).toBeVisible()
  await page.reload()
  await expectHydrated(page)
  await page.goBack()
  await expect(page).toHaveURL(/\/dashboard$/)
  await post.getByRole('button', { name: /^Delete post:/ }).click()
  const dialog = page.getByRole('alertdialog', { name: 'Delete this post?' })
  await expect(dialog).toBeVisible()
  expect(await page.evaluate(() => getComputedStyle(document.body).overflow)).toBe('hidden')
  await dialog.getByRole('button', { name: 'Keep it' }).click()
  await expect(dialog).toHaveCount(0)
})
