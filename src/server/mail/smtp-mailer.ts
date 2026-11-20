import '@tanstack/react-start/server-only'
import { Redacted } from 'effect'
import { createTransport } from 'nodemailer'
import type { Mailer } from './mailer.ts'

export const createSmtpMailer = (options: { from: string; url: Redacted.Redacted }): Mailer => {
  const transport = createTransport({
    connectionTimeout: 5000,
    greetingTimeout: 5000,
    socketTimeout: 15_000,
    url: Redacted.value(options.url),
  })
  return {
    close() {
      transport.close()
    },
    async send(message) {
      await transport.sendMail({ from: options.from, subject: message.subject, text: message.text, to: message.to })
    },
  }
}
