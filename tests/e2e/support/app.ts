import { join } from 'node:path'
import type { APIRequestContext, Cookie, Page, Route, TestInfo } from '@playwright/test'
import { APP_NAME } from '#/config/app.ts'
import { POST_MAX_LENGTH, POSTS_PAGE_DEFAULT } from '#/contract/limits.ts'
import type { Post, PostPage } from '#/sdk/types.gen.ts'
import { createVerifiedUser } from '../../../scripts/create-user.ts'
import {
  assertNoCspViolations,
  closeSharedBrowser,
  expect,
  openSharedBrowser,
  resetSharedPage,
  test as base,
} from '../fixtures.ts'
import type { SharedBrowser } from '../fixtures.ts'

const appUrl = process.env.APP_URL ?? 'http://localhost:3000'

const HYDRATION_TIMEOUT = 15_000

export type Author = { email: string; name: string; password: string }

export const createAuthor = async (name: string): Promise<Author & { id: string }> => {
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is not set for E2E author creation')
  }
  const author = { email: `e2e-${crypto.randomUUID()}@example.test`, name, password: `pw-${crypto.randomUUID()}` }
  try {
    const created = await createVerifiedUser({ databaseUrl, ...author })
    return { ...author, id: created.id }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    throw new Error(`could not create the E2E author ${author.email}: ${reason}`, { cause: error })
  }
}

let clientCount = 0
export const nextClientIp = (workerIndex: number) => `198.19.${workerIndex % 256}.${++clientCount % 256}`

type WorkerSession = { cookieHeader: string; cookies: Array<Cookie> }
const workerSessions = new WeakMap<Author, WorkerSession>()

export const test = base.extend<object, { author: Author }>({
  author: [
    async ({ playwright }, provide, workerInfo) => {
      const author = await createAuthor(`E2E Author ${workerInfo.workerIndex}`)
      const api = await playwright.request.newContext({
        baseURL: appUrl,
        extraHTTPHeaders: { origin: appUrl, 'x-forwarded-for': nextClientIp(workerInfo.workerIndex) },
      })
      try {
        await signIn(api, author)
        const { cookies } = await api.storageState()
        const cookieHeader = cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join('; ')
        workerSessions.set(author, { cookieHeader, cookies })
      } finally {
        await api.dispose()
      }
      await provide(author)
    },
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

export const sharedPageTest = test.extend<object, { sharedBrowser: SharedBrowser }>({
  context: async ({ sharedBrowser }, provide, testInfo) => {
    await sharedBrowser.context.setExtraHTTPHeaders({ 'x-forwarded-for': nextClientIp(testInfo.workerIndex) })
    await provide(sharedBrowser.context)
  },
  cspViolations: async ({ sharedBrowser }, provide) => {
    sharedBrowser.violations.length = 0
    await provide(sharedBrowser.violations)
    assertNoCspViolations(sharedBrowser.violations)
  },
  page: async ({ sharedBrowser }, provide, testInfo) => {
    await sharedBrowser.context.setExtraHTTPHeaders({ 'x-forwarded-for': nextClientIp(testInfo.workerIndex) })
    try {
      await provide(sharedBrowser.page)
    } finally {
      await resetSharedPage(sharedBrowser)
    }
  },
  sharedBrowser: [
    async ({ browser }, provide, workerInfo) => {
      const shared = await openSharedBrowser(browser, workerInfo, appUrl)
      try {
        await provide(shared)
      } finally {
        await closeSharedBrowser(shared)
      }
    },
    { scope: 'worker' },
  ],
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

export const authenticate = async (page: Page, author: Author) => {
  const session = workerSessions.get(author)
  if (session) {
    await page.context().addCookies(session.cookies)
    return
  }
  await signIn(page, author)
}

const abortPost = (route: Route) => (route.request().method() === 'POST' ? route.abort() : route.fallback())

export const failServerFunctionPosts = async (page: Page) => {
  await page.route('**/_serverFn/**', abortPost)
  return () => page.unroute('**/_serverFn/**', abortPost)
}

export const seedPost = async (request: APIRequestContext, author: Author, body = `seed ${crypto.randomUUID()}`) => {
  const session = workerSessions.get(author)
  const headers: Record<string, string> = session ? { cookie: session.cookieHeader } : {}
  if (!session) {
    await signIn(request, author)
  }
  const res = await request.post('/api/me/posts', { data: { body }, headers })
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
  await authenticate(page, author)
  const body = `a11y post ${crypto.randomUUID()}`
  const res = await page.request.post('/api/me/posts', { data: { body }, headers: { origin: appUrl } })
  expect(res.status()).toBe(201)
  await visit(page, '/dashboard')
  const post = page.getByTestId('my-posts').locator(':scope > li').filter({ hasText: body })
  await expect(post).toBeVisible()
  return { body, edit: post.getByRole('button', { name: /^Edit/ }), post }
}

export const overTheLimit = 'x'.repeat(POST_MAX_LENGTH + 1)

export const PAGINATED_AUTHOR = {
  bodies: Array.from({ length: 2 * POSTS_PAGE_DEFAULT + 5 }, (_, i) => `paginated post ${i + 1}`),
  storageState: (testInfo: TestInfo) => join(testInfo.project.outputDir, '.seed', 'paginated-author.json'),
}
