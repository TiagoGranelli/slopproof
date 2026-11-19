import '@tanstack/react-start/server-only'

/** A plain-text email. Senders build these; a Mailer delivers them. */
export interface MailMessage {
  readonly subject: string
  readonly text: string
  readonly to: string
}

/**
 * Delivers mail. Provider-agnostic: ./smtp-mailer.ts speaks SMTP (any provider, or Mailpit locally),
 * ./log-mailer.ts only records that a message was due. An HTTP-API provider is another implementation.
 */
export interface Mailer {
  /** Releases connections. Called once at shutdown, after pending sends settled. */
  close(): void
  /** Resolves once the provider accepted the message; rejects if it did not. */
  send(message: MailMessage): Promise<void>
}
