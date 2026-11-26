import { expect, test as base } from '@playwright/test'
import type { Browser, BrowserContext, BrowserContextOptions, Page, WorkerInfo } from '@playwright/test'

export type CspViolation = {
  blocked: string
  directive: string
  disposition: string
  page: string
  sample: string
}

type ReportViolation = (violation: Omit<CspViolation, 'page'>) => void

export type SharedBrowser = {
  context: BrowserContext
  page: Page
  violations: Array<CspViolation>
}

export const installCspMonitor = async (context: BrowserContext, violations: Array<CspViolation>) => {
  await context.exposeBinding('reportCspViolation', ({ page }, violation: Omit<CspViolation, 'page'>) => {
    violations.push({ page: page.url(), ...violation })
  })
  await context.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (event) => {
      const report = (window as Window & { reportCspViolation?: ReportViolation }).reportCspViolation
      report?.({
        blocked: event.blockedURI,
        directive: event.effectiveDirective,
        disposition: event.disposition,
        sample: event.sample,
      })
    })
  })
}

export const assertNoCspViolations = (violations: Array<CspViolation>) => {
  const recorded = [...violations]
  violations.length = 0
  expect(recorded, 'Content-Security-Policy violations').toEqual([])
}

const applyDeviceOptions = (options: BrowserContextOptions, projectUse: BrowserContextOptions) => {
  if (projectUse.deviceScaleFactor !== undefined) {
    options.deviceScaleFactor = projectUse.deviceScaleFactor
  }
  if (projectUse.hasTouch !== undefined) {
    options.hasTouch = projectUse.hasTouch
  }
  if (projectUse.isMobile !== undefined) {
    options.isMobile = projectUse.isMobile
  }
  if (projectUse.screen !== undefined) {
    options.screen = projectUse.screen
  }
  if (projectUse.userAgent !== undefined) {
    options.userAgent = projectUse.userAgent
  }
  if (projectUse.viewport !== undefined) {
    options.viewport = projectUse.viewport
  }
}

const applyLocaleOptions = (options: BrowserContextOptions, projectUse: BrowserContextOptions) => {
  if (projectUse.colorScheme !== undefined) {
    options.colorScheme = projectUse.colorScheme
  }
  if (projectUse.locale !== undefined) {
    options.locale = projectUse.locale
  }
  if (projectUse.reducedMotion !== undefined) {
    options.reducedMotion = projectUse.reducedMotion
  }
  if (projectUse.timezoneId !== undefined) {
    options.timezoneId = projectUse.timezoneId
  }
}

const sharedContextOptions = (projectUse: BrowserContextOptions, fallbackBaseUrl: string): BrowserContextOptions => {
  const options: BrowserContextOptions = { baseURL: projectUse.baseURL ?? fallbackBaseUrl }
  applyDeviceOptions(options, projectUse)
  applyLocaleOptions(options, projectUse)
  return options
}

export const openSharedBrowser = async (
  browser: Browser,
  workerInfo: WorkerInfo,
  fallbackBaseUrl: string,
): Promise<SharedBrowser> => {
  const context = await browser.newContext(sharedContextOptions(workerInfo.project.use, fallbackBaseUrl))
  const violations: Array<CspViolation> = []
  await installCspMonitor(context, violations)
  const page = await context.newPage()
  return { context, page, violations }
}

export const closeSharedBrowser = async (shared: SharedBrowser) => {
  await shared.context.close()
}

export const resetSharedPage = async (shared: SharedBrowser) => {
  if (shared.page.isClosed()) {
    await shared.context.clearCookies()
    shared.page = await shared.context.newPage()
    return
  }
  shared.page.removeAllListeners('request')
  await shared.page.unrouteAll({ behavior: 'ignoreErrors' })
  await shared.context.unrouteAll({ behavior: 'ignoreErrors' })
  await shared.page.emulateMedia({ colorScheme: null })
  if (shared.page.url().startsWith('http')) {
    await shared.page.evaluate(() => {
      localStorage.clear()
      sessionStorage.clear()
    })
  }
  await shared.context.clearCookies()
  await shared.page.goto('about:blank')
}

export const test = base.extend<{ cspViolations: Array<CspViolation> }>({
  cspViolations: [
    async ({ context }, use) => {
      const violations: Array<CspViolation> = []
      await installCspMonitor(context, violations)
      await use(violations)
      assertNoCspViolations(violations)
    },
    { auto: true },
  ],
})

export { expect }
