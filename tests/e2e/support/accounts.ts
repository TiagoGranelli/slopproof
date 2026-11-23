import type { Browser, BrowserContext, Page, TestInfo } from '@playwright/test'
import { createAuthor, expect, followLink, nextClientIp, signIn, visit } from './app.ts'
import type { Author } from './app.ts'

const appUrl = process.env.APP_URL ?? 'http://localhost:3000'
const mailpitUrl = process.env.MAILPIT_URL ?? 'http://127.0.0.1:54380'

export const newAccount = (): Author => ({
  email: `e2e-${crypto.randomUUID()}@example.test`,
  name: 'E2E Account',
  password: `pw-${crypto.randomUUID()}`,
})

export const newClient = (browser: Browser, testInfo: TestInfo): Promise<BrowserContext> =>
  browser.newContext({
    baseURL: appUrl,
    extraHTTPHeaders: { 'x-forwarded-for': nextClientIp(testInfo.workerIndex) },
  })

type MailSummary = { ID: string; Subject: string }

export const mailLink = async (to: string, subject: string, path: '/verify-email' | '/reset-password') => {
  let id: string | undefined
  await expect
    .poll(
      async () => {
        const query = encodeURIComponent(`to:"${to}" subject:"${subject}"`)
        const res = await fetch(`${mailpitUrl}/api/v1/search?query=${query}`)
        const { messages } = (await res.json()) as { messages: Array<MailSummary> }
        id = messages.find((message) => message.Subject === subject)?.ID
        return id
      },
      { message: `mail "${subject}" to ${to}`, timeout: 10_000 },
    )
    .toBeTruthy()
  const message = (await (await fetch(`${mailpitUrl}/api/v1/message/${id}`)).json()) as { Text: string }
  const link = message.Text.match(new RegExp(`https?://\\S+${path}\\?token=\\S+`))?.[0]
  expect(link, `link to ${path} in "${subject}"`).toBeTruthy()
  return link!
}

export const createAccount = (): Promise<Author> => createAuthor('E2E Account')

export const signInWithForm = async (page: Page, account: Pick<Author, 'email' | 'password'>) => {
  await page.getByRole('textbox', { exact: true, name: 'Email' }).fill(account.email)
  await page.getByLabel('Password', { exact: true }).fill(account.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
}

export const expectFormSignInRefused = async (
  page: Page,
  account: Pick<Author, 'email' | 'password'>,
  message: string,
) => {
  await visit(page, '/login')
  await signInWithForm(page, account)
  await expect(page.getByRole('alert')).toContainText(message)
}

export const signUpWithForm = async (page: Page, account: Author) => {
  await page.getByLabel('Name').fill(account.name)
  await page.getByRole('textbox', { exact: true, name: 'Email' }).fill(account.email)
  await page.getByLabel('Password').fill(account.password)
  await page.getByRole('button', { name: 'Create account' }).click()
}

export const requestPasswordReset = async (page: Page, email: string) => {
  await visit(page, '/login')
  await followLink(page, 'Forgot your password?', /\/forgot-password$/)
  await page.getByRole('textbox', { exact: true, name: 'Email' }).fill(email)
  await page.getByRole('button', { name: 'Send reset link' }).click()
}

export const setPasswordWithLink = async (page: Page, link: string, password: string) => {
  await visit(page, link)
  await page.getByLabel('New password').fill(password)
  await page.getByRole('button', { name: 'Set new password' }).click()
}

export const signedInElsewhere = async (browser: Browser, testInfo: TestInfo, account: Author) => {
  const elsewhere = await newClient(browser, testInfo)
  await signIn(elsewhere.request, account)
  return elsewhere
}

export const signedInHereAndElsewhere = async (page: Page, browser: Browser, testInfo: TestInfo) => {
  const account = await createAccount()
  const [elsewhere] = await Promise.all([signedInElsewhere(browser, testInfo, account), signIn(page, account)])
  return { account, elsewhere }
}

export const expectSignedOut = async (page: Page) => {
  await page.goto('/dashboard')
  await expect(page).toHaveURL(/\/login\?redirect=%2Fdashboard$/)
}
