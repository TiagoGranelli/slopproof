import type { Page } from '@playwright/test'
import { authenticate, expect, lastPage, test, visit } from './support/app.ts'

const FIXED_CLOCK = new Date('2026-06-01T12:00:00.000Z')

const SEEDED_POSTS = lastPage(
  {
    authorName: 'Visual Author',
    body: 'First deterministic baseline post for visual regression checks.',
    createdAt: '2026-01-02T03:04:05.000Z',
    id: '01950000-0000-7000-8000-000000000001',
    updatedAt: '2026-01-02T03:04:05.000Z',
  },
  {
    authorName: 'Visual Author',
    body: 'Second deterministic baseline post with steady timestamps.',
    createdAt: '2026-01-01T12:00:00.000Z',
    id: '01950000-0000-7000-8000-000000000002',
    updatedAt: '2026-01-01T12:00:00.000Z',
  },
)

const SCREENSHOT_OPTIONS = {
  animations: 'disabled' as const,
  fullPage: true,
  maxDiffPixelRatio: 0.01,
}

const VIEWPORTS = [
  { height: 800, label: 'desktop', width: 1280 },
  { height: 844, label: 'mobile', width: 390 },
] as const

const ROUTES = [
  { label: 'home', path: '/' },
  { label: 'about', path: '/about' },
  { label: 'login', path: '/login' },
] as const

const prepareDeterministicPage = async (page: Page) => {
  await page.clock.setFixedTime(FIXED_CLOCK)
  await page.route('**/api/posts*', (route) =>
    route.request().method() === 'GET' ? route.fulfill({ json: SEEDED_POSTS }) : route.fallback(),
  )
  await page.route('**/api/me/posts*', (route) =>
    route.request().method() === 'GET' ? route.fulfill({ json: SEEDED_POSTS }) : route.fallback(),
  )
}

test.describe('visual regression baselines', () => {
  test.skip(!process.env.PW_VISUAL, 'visual baselines run when PW_VISUAL=1')
  test.use({ timezoneId: 'UTC' })

  for (const viewport of VIEWPORTS) {
    for (const colorScheme of ['light', 'dark'] as const) {
      test.describe(`${viewport.label} ${colorScheme}`, () => {
        test.use({ colorScheme, viewport: { height: viewport.height, width: viewport.width } })

        for (const route of ROUTES) {
          test(`${route.label} matches baseline`, async ({ page }) => {
            await prepareDeterministicPage(page)
            await visit(page, route.path)
            await expect(page).toHaveScreenshot(
              `${route.label}-${viewport.label}-${colorScheme}.png`,
              SCREENSHOT_OPTIONS,
            )
          })
        }

        test('dashboard matches baseline', async ({ author, page }) => {
          await prepareDeterministicPage(page)
          await authenticate(page, author)
          await visit(page, '/dashboard')
          await expect(page).toHaveScreenshot(`dashboard-${viewport.label}-${colorScheme}.png`, SCREENSHOT_OPTIONS)
        })
      })
    }
  }

  test.describe('desktop forced-colors', () => {
    test.use({ forcedColors: 'active', viewport: { height: 800, width: 1280 } })

    for (const route of ROUTES) {
      test(`${route.label} forced-colors matches baseline`, async ({ page }) => {
        await prepareDeterministicPage(page)
        await visit(page, route.path)
        await expect(page).toHaveScreenshot(`${route.label}-desktop-forced-colors.png`, SCREENSHOT_OPTIONS)
      })
    }
  })
})
