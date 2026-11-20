import type { Page } from '@playwright/test'
import { expect, test, visit } from './support/app.ts'

const background = (page: Page) =>
  page.evaluate(() => {
    const context = Object.assign(document.createElement('canvas'), { height: 1, width: 1 }).getContext('2d')!
    context.fillStyle = getComputedStyle(document.body).backgroundColor
    context.fillRect(0, 0, 1, 1)
    const [red, green, blue] = context.getImageData(0, 0, 1, 1).data
    return `rgb(${red}, ${green}, ${blue})`
  })

const WHITE = 'rgb(255, 255, 255)'
const NEAR_BLACK = 'rgb(10, 10, 10)'

test('follows the system theme with CSS alone, JavaScript off', async ({ browser }) => {
  const context = await browser.newContext({ colorScheme: 'dark', javaScriptEnabled: false })
  const page = await context.newPage()
  await page.goto('/login')
  expect(await background(page)).toBe(NEAR_BLACK)
  await context.close()
})

for (const path of ['/', '/about']) {
  test(`a chosen theme is on ${path} from the first paint, before the app's scripts run`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' })
    await page.addInitScript(() => localStorage.setItem('theme', 'dark'))
    await page.route('**/assets/*.js', (route) => route.abort())
    await page.goto(path)
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    expect(await background(page)).toBe(NEAR_BLACK)
  })
}

test('the theme choice applies at once, survives a reload, and System hands back to the system', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' })
  await visit(page, '/')
  expect(await background(page)).toBe(NEAR_BLACK)
  await page.getByRole('radio', { name: 'Light' }).check()
  expect(await background(page)).toBe(WHITE)
  await visit(page, '/')
  await expect(page.getByRole('radio', { name: 'Light' })).toBeChecked()
  expect(await background(page)).toBe(WHITE)
  await page.getByRole('radio', { name: 'System' }).check()
  expect(await background(page)).toBe(NEAR_BLACK)
})

const focusOutline = (page: Page) =>
  page.locator(':focus').evaluate((element) => {
    const style = getComputedStyle(element)
    return Promise.all(element.getAnimations().map((animation) => animation.finished)).then(
      () => `${element.tagName.toLowerCase()} ${style.outlineStyle} ${style.outlineWidth}`,
    )
  })

const segmentColors = (page: Page, name: string) =>
  page
    .getByRole('radio', { name })
    .locator('..')
    .evaluate((label) => {
      const probe = document.createElement('span')
      document.body.append(probe)
      probe.style.backgroundColor = 'Highlight'
      const highlight = getComputedStyle(probe).backgroundColor
      probe.remove()
      return { background: getComputedStyle(label).backgroundColor, highlight }
    })

test.describe('forced colors', () => {
  test.skip(({ isMobile }) => isMobile, 'Windows High Contrast is a desktop setting')
  test.use({ forcedColors: 'active' })

  test('keeps keyboard focus visible as an outline on links, fields and buttons', async ({ page }) => {
    await visit(page, '/login')
    const outlines: Array<string> = []
    for (let press = 0; press < 7; press++) {
      await page.keyboard.press('Tab')
      outlines.push(await focusOutline(page))
    }
    expect(outlines).toEqual([
      ...Array.from({ length: 4 }, () => 'a solid 2px'),
      'input solid 2px',
      'input solid 2px',
      'button solid 2px',
    ])
  })

  test('shows the chosen theme and the current page without relying on color', async ({ page }) => {
    await visit(page, '/about')
    const checked = await segmentColors(page, 'System')
    expect(checked.background).toBe(checked.highlight)
    expect((await segmentColors(page, 'Dark')).background).not.toBe(checked.highlight)
    const about = page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'About' })
    await expect(about).toHaveAttribute('aria-current', 'page')
    await expect(about).toHaveCSS('text-decoration-line', 'underline')
  })
})
