import { execFile } from 'node:child_process'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import type { APIRequestContext, Page, Route, TestInfo } from '@playwright/test'
import { APP_NAME } from '#/config/app.ts'
import { POST_MAX_LENGTH, POSTS_PAGE_DEFAULT } from '#/contract/limits.ts'
import type { Post, PostPage } from '#/sdk/types.gen.ts'
import { test as base, expect } from '../fixtures.ts'

const appUrl = process.env.APP_URL ?? 'http://localhost:3000'

const HYDRATION_TIMEOUT = 15_000

export type Author = { email: string; name: string; password: string }

const CREATE_USER = fileURLToPath(new URL('../../../scripts/create-user.ts', import.meta.url))

export const createAuthor = async (name: string): Promise<Author> => {
  const author = { email: `e2e-${crypto.randomUUID()}@example.test`, name, password: `pw-${crypto.randomUUID()}` }
  try {
    await promisify(execFile)(process.execPath, [CREATE_USER, author.email, author.name], {
      env: { ...process.env, CREATE_USER_PASSWORD: author.password },
    })
  } catch (error) {
    const { stderr } = error as { stderr?: string }
    throw new Error(`could not create the E2E author ${author.email}: ${stderr?.trim() || String(error)}`, {
      cause: error,
    })
  }
  return author
}

let clientCount = 0
export const nextClientIp = (workerIndex: number) => `198.19.${workerIndex % 256}.${++clientCount % 256}`

export const test = base.extend<object, { author: Author }>({
  author: [
    // Playwright reads the fixtures a fixture uses from its first parameter, which must be a destructuring.
    // oxlint-disable-next-line no-empty-pattern
    async ({}, provide, workerInfo) => provide(await createAuthor(`E2E Author ${workerInfo.workerIndex}`)),
    { scope: 'worker' },
  ],
  context: async ({ context }, provide, testInfo) => {
    await context.setExtraHTTPHeaders({ 'x-forwarded-for': nextClientIp(testInfo.workerIndex) })
    await provide(context)
  },
  request: async ({ playwright }, provide, testInfo) => {
    const request = await playwright.request.newContext({
      baseURL: appUrl,
      extraHTTPHeaders: { origin: appUrl, 'x-forwarded-for': nextClientIp(testInfo.workerIndex) },
    })
    await provide(request)
    await request.dispose()
  },
})
export { expect }

export const expectHydrated = (page: Page) =>
  expect(page.locator('body[data-hydrated="true"]')).toBeAttached({ timeout: HYDRATION_TIMEOUT })

export const visit = async (page: Page, path: string) => {
  const response = await page.goto(path)
  await expectHydrated(page)
  return response
}

export const expectFlash = async (page: Page, url: RegExp, message: string) => {
  await expect(page).toHaveURL(url)
  await expect(page.getByTestId('flash')).toHaveText(message)
}

export const followLink = async (page: Page, name: string, url: RegExp) => {
  await page.getByRole('main').getByRole('link', { name }).click()
  await expect(page).toHaveURL(url)
  await expectHydrated(page)
  await expect(page.getByRole('heading', { level: 1 })).toBeFocused()
}

export const signIn = async (client: Page | APIRequestContext, author: Author) => {
  const request = 'request' in client ? client.request : client
  const res = await request.post('/api/auth/sign-in/email', {
    data: { email: author.email, password: author.password },
    headers: { origin: appUrl },
  })
  expect(res.status()).toBe(200)
}

const abortPost = (route: Route) => (route.request().method() === 'POST' ? route.abort() : route.fallback())

export const failServerFunctionPosts = async (page: Page) => {
  await page.route('**/_serverFn/**', abortPost)
  return () => page.unroute('**/_serverFn/**', abortPost)
}

export const seedPost = async (request: APIRequestContext, author: Author, body = `seed ${crypto.randomUUID()}`) => {
  await signIn(request, author)
  const res = await request.post('/api/me/posts', { data: { body } })
  expect(res.status()).toBe(201)
  return (await res.json()) as Post
}

export const fakePost = (body: string): Post => ({
  authorName: 'Test Author',
  body,
  createdAt: '2026-01-02T03:04:05.000Z',
  id: crypto.randomUUID(),
  updatedAt: '2026-01-02T03:04:05.000Z',
})

export const lastPage = (...posts: Array<Post>): PostPage => ({ items: posts, nextCursor: null })

const PAGE_LINK = {
  '/api/me/posts': 'Dashboard',
  '/api/posts': APP_NAME,
} as const

export const navigateWithApiResponse = async (
  page: Page,
  api: keyof typeof PAGE_LINK,
  response: { json: unknown; status?: number },
) => {
  await visit(page, '/about')
  await page.route(`**${api}`, (route) =>
    route.request().method() === 'GET' ? route.fulfill(response) : route.fallback(),
  )
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { exact: true, name: PAGE_LINK[api] }).click()
}

export const dashboardWithMyPost = async (page: Page, author: Author) => {
  await signIn(page, author)
  await visit(page, '/dashboard')
  const body = `a11y post ${crypto.randomUUID()}`
  await page.getByLabel('New post').fill(body)
  await page.getByRole('button', { name: 'Publish' }).click()
  const post = page.getByTestId('my-posts').locator(':scope > li').filter({ hasText: body })
  await expect(post).toBeVisible()
  return { body, edit: post.getByRole('button', { name: /^Edit/ }), post }
}

export const overTheLimit = 'x'.repeat(POST_MAX_LENGTH + 1)

export const PAGINATED_AUTHOR = {
  bodies: Array.from({ length: 2 * POSTS_PAGE_DEFAULT + 5 }, (_, i) => `paginated post ${i + 1}`),
  storageState: (testInfo: TestInfo) => join(testInfo.project.outputDir, '.seed', 'paginated-author.json'),
}
