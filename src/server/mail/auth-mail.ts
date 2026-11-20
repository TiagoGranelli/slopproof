import '@tanstack/react-start/server-only'
import { runInBackground } from '../background-tasks.ts'
import { env } from '../env.ts'
import { onShutdown } from '../lifecycle.ts'
import { authMessages } from './auth-messages.ts'
import { createLogMailer } from './log-mailer.ts'
import type { Mailer, MailMessage } from './mailer.ts'
import { createSmtpMailer } from './smtp-mailer.ts'

const mailer: Mailer = env.smtp ? createSmtpMailer(env.smtp) : createLogMailer({ withContent: !env.isProduction })

onShutdown('mailer', () => mailer.close())

const messages = authMessages(env.appUrl)

const schedule = (message: MailMessage): Promise<void> => {
  runInBackground(mailer.send(message))
  return Promise.resolve()
}

interface MailTo {
  readonly user: { readonly email: string; readonly name: string }
}

export const authMail = {
  existingAccount: ({ user }: MailTo): Promise<void> => schedule(messages.existingAccount(user)),
  resetPassword: ({ token, user }: MailTo & { readonly token: string }): Promise<void> =>
    schedule(messages.resetPassword(user, token)),
  verifyEmail: ({ token, user }: MailTo & { readonly token: string }): Promise<void> =>
    schedule(messages.verifyEmail(user, token)),
}
