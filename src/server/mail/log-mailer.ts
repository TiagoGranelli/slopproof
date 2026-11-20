import '@tanstack/react-start/server-only'
import { log } from '../log.ts'
import type { Mailer } from './mailer.ts'

export const createLogMailer = (options: { withContent: boolean }): Mailer => ({
  close() {},
  async send(message) {
    const { subject, text, to } = message
    log('warn', 'mail not delivered: SMTP_URL is unset', options.withContent ? { subject, text, to } : { subject })
  },
})
