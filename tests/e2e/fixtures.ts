import { expect, test as base } from '@playwright/test'

export type CspViolation = {
  blocked: string
  directive: string
  disposition: string
  page: string
  sample: string
}

type ReportViolation = (violation: Omit<CspViolation, 'page'>) => void

/**
 * Every E2E test runs with a Content-Security-Policy violation collector: each `securitypolicyviolation`
 * event in any page of the test's browser context is reported to the test, which fails if any arrived.
 * A test that provokes violations on purpose reads and empties `cspViolations` itself.
 */
export const test = base.extend<{ cspViolations: Array<CspViolation> }>({
  cspViolations: [
    async ({ context }, use) => {
      const violations: Array<CspViolation> = []
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
      await use(violations)
      expect(violations, 'Content-Security-Policy violations').toEqual([])
    },
    { auto: true },
  ],
})

export { expect }
