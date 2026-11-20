import type { Page } from '@playwright/test'
import { POSTS_PAGE_DEFAULT as PAGE_SIZE } from '#/contract/limits.ts'
import { expect, PAGINATED_AUTHOR, test, visit } from './support/app.ts'

const publicListRequest = (url: URL) => url.pathname === '/api/posts'

const items = (page: Page, testId: string) => page.getByTestId(testId).locator(':scope > li')

const postBodies = (page: Page, testId: string) =>
  items(page, testId).evaluateAll((posts) => posts.map((post) => post.querySelector('p')?.textContent))

const recordRequests = (page: Page, pathname: string) => {
  const urls: Array<string> = []
  page.on('request', (r) => new URL(r.url()).pathname === pathname && urls.push(r.url()))
  return urls
}

const loadMoreWithKeyboard = async (page: Page, testId: string, key: 'Enter' | ' ') => {
  const before = await items(page, testId).count()
  const button = page.getByRole('button', { name: 'Load more posts' })
  await button.focus()
  await page.keyboard.press(key)
  await expect(items(page, testId).nth(before)).toBeFocused()
  const bodies = await postBodies(page, testId)
  expect(bodies.length).toBeGreaterThan(before)
  expect(bodies.length).toBeLessThanOrEqual(before + PAGE_SIZE)
  expect(new Set(bodies).size).toBe(bodies.length)
}

test.describe('as the seeded author', () => {
  test.use({
    // Playwright reads the fixtures a fixture uses from its first parameter, which must be a destructuring.
    // oxlint-disable-next-line no-empty-pattern
    storageState: async ({}, provide, testInfo) => provide(PAGINATED_AUTHOR.storageState(testInfo)),
  })

  test('the dashboard renders the first page on the server and loads the rest with Load more', async ({ page }) => {
    const listRequests = recordRequests(page, '/api/me/posts')
    await visit(page, '/dashboard')
    await expect(items(page, 'my-posts')).toHaveCount(PAGE_SIZE)
    await page.waitForLoadState('networkidle')
    expect(listRequests).toEqual([])

    await loadMoreWithKeyboard(page, 'my-posts', 'Enter')
    expect(listRequests).toHaveLength(1)
    expect(new URL(listRequests[0]!).searchParams.get('cursor')).toEqual(expect.any(String))
    const focused = items(page, 'my-posts').nth(PAGE_SIZE)
    await page.keyboard.press('Tab')
    await expect(focused.getByRole('button', { name: /^Edit/ })).toBeFocused()

    await loadMoreWithKeyboard(page, 'my-posts', ' ')
    await expect(page.getByRole('button', { name: 'Load more posts' })).toHaveCount(0)
    await expect(page.locator(':focus')).toHaveCount(1)
    expect(await postBodies(page, 'my-posts')).toEqual(PAGINATED_AUTHOR.bodies.toReversed())
  })
})

test('the public list loads more posts after the first page, without repeating any', async ({ page }) => {
  await visit(page, '/')
  await expect(items(page, 'public-posts')).toHaveCount(PAGE_SIZE)
  await loadMoreWithKeyboard(page, 'public-posts', 'Enter')
})

test('a failed Load more says so, keeps focus on the button and can be retried', async ({ page }) => {
  await visit(page, '/')
  await page.route(publicListRequest, (route) => route.abort())
  const button = page.getByRole('button', { name: 'Load more posts' })
  await button.focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('alert')).toContainText('Could not load more posts', { timeout: 15_000 })
  await expect(button).toBeFocused()
  await page.unroute(publicListRequest)
  await page.keyboard.press('Enter')
  await expect(items(page, 'public-posts').nth(PAGE_SIZE)).toBeFocused()
  await expect(page.getByRole('alert')).toHaveCount(0)
})
