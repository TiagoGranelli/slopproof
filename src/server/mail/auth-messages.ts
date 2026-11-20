import '@tanstack/react-start/server-only'
import { APP_NAME } from '#/config/app.ts'
import type { MailMessage } from './mailer.ts'

interface Recipient {
  readonly email: string
  readonly name: string
}

const signature = `\n\n— ${APP_NAME}`

type LinkTo = (path: string, token?: string) => string

const verifyEmail = (linkTo: LinkTo, to: Recipient, token: string): MailMessage => ({
  subject: 'Confirm your email address',
  text:
    `Hi ${to.name},\n\nConfirm that this is your email address by opening this link:\n\n` +
    `${linkTo('/verify-email', token)}\n\nThe link works for one hour. If you did not create an account, ` +
    `ignore this message.${signature}`,
  to: to.email,
})

const resetPassword = (linkTo: LinkTo, to: Recipient, token: string): MailMessage => ({
  subject: 'Reset your password',
  text:
    `Hi ${to.name},\n\nSomeone asked to reset the password of your account. To choose a new one, open this ` +
    `link:\n\n${linkTo('/reset-password', token)}\n\nThe link works once, for one hour. A new password signs ` +
    `out every session. If you did not ask for this, ignore this message: your password stays the same.` +
    signature,
  to: to.email,
})

const existingAccount = (linkTo: LinkTo, to: Recipient): MailMessage => ({
  subject: 'Someone tried to sign up with your email address',
  text:
    `Hi ${to.name},\n\nSomeone tried to create an account with this email address, which already has one. ` +
    `If it was you, sign in at ${linkTo('/login')}, or choose a new password at ${linkTo('/forgot-password')}. ` +
    `Otherwise, ignore this message.${signature}`,
  to: to.email,
})

interface AuthMessages {
  readonly existingAccount: (to: Recipient) => MailMessage
  readonly resetPassword: (to: Recipient, token: string) => MailMessage
  readonly verifyEmail: (to: Recipient, token: string) => MailMessage
}

export const authMessages = (appUrl: string): AuthMessages => {
  const linkTo: LinkTo = (path, token) => {
    const url = new URL(path, appUrl)
    if (token !== undefined) {
      url.searchParams.set('token', token)
    }
    return url.href
  }
  return {
    existingAccount: (to) => existingAccount(linkTo, to),
    resetPassword: (to, token) => resetPassword(linkTo, to, token),
    verifyEmail: (to, token) => verifyEmail(linkTo, to, token),
  }
}
