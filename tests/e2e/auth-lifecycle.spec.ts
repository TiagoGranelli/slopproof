import type { APIRequestContext, Locator } from '@playwright/test'
import { FLASH_MESSAGES } from '#/lib/flash.ts'
import {
  createAccount,
  expectFormSignInRefused,
  expectSignedOut,
  mailLink,
  newAccount,
  requestPasswordReset,
  setPasswordWithLink,
  signedInElsewhere,
  signedInHereAndElsewhere,
  signInWithForm,
  signUpWithForm,
} from './support/accounts.ts'
import { type Author, expect, expectFlash, followLink, signIn, test, visit } from './support/app.ts'

const expectApiSignInUnverified = async (request: APIRequestContext, account: Author) => {
  const early = await request.post('/api/auth/sign-in/email', {
    data: { email: account.email, password: account.password },
  })
  expect(early.status()).toBe(403)
  expect(await early.json()).toMatchObject({ code: 'EMAIL_NOT_VERIFIED' })
}

const expectFieldIssue = async (field: Locator, message: string) => {
  await expect(field).toHaveAttribute('aria-invalid', 'true')
  await expect(field).toHaveAccessibleDescription(message)
  await expect(field).toBeFocused()
}

const submitDeletion = async (deletion: Locator, password: string) => {
  await deletion.getByLabel('Password', { exact: true }).fill(password)
  await deletion.getByRole('button', { name: 'Delete account' }).click()
}

test('signs up, confirms the address from the mail, then signs in', async ({ page, request }) => {
  const account = newAccount()

  await visit(page, '/login')
  await followLink(page, 'Create one', /\/sign-up$/)
  await signUpWithForm(page, account)
  await expect(page.getByRole('status')).toContainText(`Check your inbox at ${account.email}`)

  await expectFormSignInRefused(page, account, 'Confirm your email address first')

  const link = await mailLink(account.email, 'Confirm your email address', '/verify-email')
  expect((await request.get(link)).status()).toBe(200)
  await expectApiSignInUnverified(request, account)

  await visit(page, link)
  await page.getByRole('button', { name: 'Confirm email' }).click()
  await expect(page.getByRole('status')).toContainText('Your email address is confirmed')
  await followLink(page, 'Sign in', /\/login$/)
  await signInWithForm(page, account)
  await expect(page).toHaveURL(/\/dashboard$/)
})

test('resets a forgotten password from the mailed link, which ends every session', async ({
  browser,
  page,
}, testInfo) => {
  const account = await createAccount()
  const elsewhere = await signedInElsewhere(browser, testInfo, account)

  await requestPasswordReset(page, account.email)
  await expect(page.getByRole('status')).toContainText(account.email)

  const newPassword = `pw-${crypto.randomUUID()}`
  const link = await mailLink(account.email, 'Reset your password', '/reset-password')
  await setPasswordWithLink(page, link, newPassword)
  await expectFlash(page, /\/login$/, FLASH_MESSAGES['password-reset'])

  await setPasswordWithLink(page, link, `pw-${crypto.randomUUID()}`)
  await expect(page.getByRole('alert')).toContainText('This link is invalid or has expired')

  await expectSignedOut(await elsewhere.newPage())

  await expectFormSignInRefused(page, account, 'Wrong email or password')
  await signInWithForm(page, { email: account.email, password: newPassword })
  await expect(page).toHaveURL(/\/dashboard$/)
  await elsewhere.close()
})

test('changing the password signs out the other sessions and keeps this one', async ({ browser, page }, testInfo) => {
  const { account, elsewhere } = await signedInHereAndElsewhere(page, browser, testInfo)

  await visit(page, '/account')
  const newPassword = `pw-${crypto.randomUUID()}`
  await page.getByLabel('Current password').fill(account.password)
  await page.getByLabel('New password').fill(newPassword)
  await page.getByRole('button', { name: 'Change password' }).click()
  await expect(page.getByRole('status')).toContainText('Password changed')
  await expect(page.getByTestId('sessions').getByRole('listitem')).toHaveCount(1)

  await expectSignedOut(await elsewhere.newPage())
  await visit(page, '/account')
  await expect(page.getByRole('heading', { exact: true, name: 'Account' })).toBeVisible()
  await elsewhere.close()
})

test('lists the sessions and signs out another one', async ({ browser, page }, testInfo) => {
  const { elsewhere } = await signedInHereAndElsewhere(page, browser, testInfo)

  await visit(page, '/account')
  const sessions = page.getByTestId('sessions').getByRole('listitem')
  await expect(sessions).toHaveCount(2)
  await expect(sessions.filter({ hasText: '(this browser)' })).toHaveCount(1)
  await sessions
    .filter({ hasNotText: '(this browser)' })
    .getByRole('button', { name: /^Sign out / })
    .click()
  await expect(sessions).toHaveCount(1)

  await expectSignedOut(await elsewhere.newPage())
  await visit(page, '/account')
  await expect(sessions).toHaveCount(1)

  await page.getByRole('button', { name: 'Sign out everywhere' }).click()
  await expectFlash(page, /\/login$/, FLASH_MESSAGES['signed-out-everywhere'])
  await expectSignedOut(page)
  await elsewhere.close()
})

test('deletes the account after the password and an explicit confirmation', async ({ page }) => {
  const account = await createAccount()
  await signIn(page, account)
  await visit(page, '/account')

  const deletion = page.getByRole('region', { name: 'Delete account' })
  await submitDeletion(deletion, 'not-the-password-123')
  await expect(deletion.getByRole('alert')).toHaveText('Confirm that you want to delete the account.')
  await expect(deletion.getByRole('checkbox')).toBeFocused()
  await deletion.getByRole('checkbox').check()
  await deletion.getByRole('button', { name: 'Delete account' }).click()
  await expectFieldIssue(deletion.getByLabel('Password', { exact: true }), 'That password is not correct.')

  await submitDeletion(deletion, account.password)
  await expectFlash(page, /\/$/, FLASH_MESSAGES['account-deleted'])
  await expectSignedOut(page)
  await expectFormSignInRefused(page, account, 'Wrong email or password')
})
