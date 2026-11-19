import '@tanstack/react-start/server-only'
import { Redacted } from 'effect'
import { createTransport } from 'nodemailer'
import type { Mailer } from './mailer.ts'

/**
 * SMTP through Nodemailer. `url` is `smtp://` (STARTTLS when the server offers it) or `smtps://` (TLS from the
 * start), with credentials in the userinfo part: `smtps://user:password@smtp.example.com:465`. Timeouts are
 * short because sends run in the background and shutdown waits for them.
 */
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
