import type { Page } from '@playwright/test'
import { expect, test } from './support/app.ts'

test.use({ javaScriptEnabled: false })

const email = (page: Page) => page.getByRole('textbox', { exact: true, name: 'Email' })

test('signs in without JavaScript and lands where the guard sent the visitor', async ({ author, page }) => {
  await page.goto('/dashboard')
  await expect(page).toHaveURL(/\/login\?redirect=%2Fdashboard$/)
  await email(page).fill(author.email)
  await page.getByLabel('Password').fill(author.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL(/\/dashboard$/)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Your posts')
  await expect(page.getByRole('navigation', { name: 'Main' })).toContainText(author.name)
})

test('without JavaScript, a wrong password comes back as the same alert on the form', async ({ author, page }) => {
  await page.goto('/login')
  await email(page).fill(author.email)
  await page.getByLabel('Password').fill('not the password at all')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL(/\/login\?error=INVALID_EMAIL_OR_PASSWORD$/)
  await expect(page.getByRole('alert')).toHaveText('Wrong email or password.')
  await expect(page.locator('form')).toHaveAccessibleDescription('Wrong email or password.')
})

test('without JavaScript, a rate-limited sign-in says how long to wait', async ({ page }) => {
  await page.goto('/login?error=RATE_LIMITED&retryAfter=12')
  await expect(page.getByRole('alert')).toHaveText('Too many attempts. Try again in 12 seconds.')
})
