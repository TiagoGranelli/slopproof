import '@tanstack/react-start/server-only'

export interface MailMessage {
  readonly subject: string
  readonly text: string
  readonly to: string
}

export interface Mailer {
  close(): void
  send(message: MailMessage): Promise<void>
}
