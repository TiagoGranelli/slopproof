import { createFileRoute } from '@tanstack/react-router'
import { Page } from '#/components/layouts/page.tsx'
import { pageTitle } from '#/config/app.ts'
import { ResendVerificationForm } from '#/features/auth/components/resend-verification-form.tsx'
import { VerifyEmailForm } from '#/features/auth/components/verify-email-form.tsx'
import { tokenFromSearch } from '#/features/auth/utils/token-search.ts'

// Opened from the confirmation email (src/server/mail/auth-messages.ts). Loading the page only shows the
// "Confirm email" button; the address is confirmed when it is pressed (a POST), so a mail scanner or link
// preview that follows the link confirms nothing.
export const Route = createFileRoute('/verify-email')({
  component: VerifyEmail,
  validateSearch: tokenFromSearch,
  head: () => ({ meta: [{ title: pageTitle('Confirm your email') }, { name: 'robots', content: 'noindex' }] }),
  headers: () => ({ 'cache-control': 'private, no-store' }),
})

function VerifyEmail() {
  const { token } = Route.useSearch()
  return (
    <Page narrow title="Confirm your email">
      {token ? (
        <VerifyEmailForm token={token} />
      ) : (
        <>
          <p>Open the link in the email we sent you. Did not get it? Ask for a new one.</p>
          <ResendVerificationForm />
        </>
      )}
    </Page>
  )
}
