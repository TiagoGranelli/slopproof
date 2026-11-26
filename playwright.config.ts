import { availableParallelism } from 'node:os'
import { defineConfig, devices } from '@playwright/test'

const baseURL = process.env.APP_URL ?? 'http://localhost:3000'

const setup = [{ name: 'seed', testMatch: /seed\.setup\.ts$/ }]
const dependencies = setup.map((project) => project.name)
const PROJECTS = [
  { dependencies, name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  {
    dependencies,
    name: 'firefox',
    use: {
      ...devices['Desktop Firefox'],
      launchOptions: { firefoxUserPrefs: { 'browser.tabs.remote.useCrossOriginOpenerPolicy': false } },
    },
  },
  { dependencies, name: 'webkit', use: { ...devices['Desktop Safari'] } },
  { dependencies, name: 'Pixel 7', use: { ...devices['Pixel 7'] } },
  { dependencies, name: 'iPhone 15', use: { ...devices['iPhone 15'] } },
]
const LOCAL_DEFAULT = ['chromium', 'firefox']

const requested = process.env.PW_PROJECTS?.trim() || (process.env.CI ? 'all' : LOCAL_DEFAULT.join(','))
const names = requested === 'all' ? PROJECTS.map((p) => p.name) : requested.split(',').map((n) => n.trim())
const unknown = names.filter((name) => !PROJECTS.some((p) => p.name === name))
if (unknown.length) {
  throw new Error(
    `PW_PROJECTS: unknown project(s) ${unknown.join(', ')}; expected all or ${PROJECTS.map((p) => p.name).join(', ')}`,
  )
}

const LOCAL_REPORTER = process.stdout.isTTY ? 'line' : 'dot'

export default defineConfig({
  failOnFlakyTests: !!process.env.CI,
  forbidOnly: !!process.env.CI,
  fullyParallel: true,
  globalSetup: './tests/e2e/global-setup.ts',
  outputDir: 'test-results/playwright',
  projects: [...setup, ...PROJECTS.filter((p) => names.includes(p.name))],
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : LOCAL_REPORTER,
  retries: process.env.CI ? 1 : 0,
  testDir: 'tests/e2e',
  timeout: 30_000,
  use: {
    baseURL,
    screenshot: 'only-on-failure',
    trace: 'on-first-retry',
  },
  workers: process.env.CI
    ? Math.min(4, availableParallelism())
    : Math.min(6, Math.max(2, Math.floor(availableParallelism() / 2))),
})
