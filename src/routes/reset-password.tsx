import { Link, createFileRoute } from '@tanstack/react-router'
import { Page } from '#/components/layouts/page.tsx'
import { pageTitle } from '#/config/app.ts'
import { ResetPasswordForm } from '#/features/auth/components/reset-password-form.tsx'
import { tokenFromSearch } from '#/features/auth/utils/token-search.ts'

export const Route = createFileRoute('/reset-password')({
  component: ResetPassword,
  validateSearch: tokenFromSearch,
  head: () => ({ meta: [{ title: pageTitle('Choose a new password') }, { name: 'robots', content: 'noindex' }] }),
  headers: () => ({ 'cache-control': 'private, no-store' }),
})

function ResetPassword() {
  const { token } = Route.useSearch()
  return (
    <Page narrow title="Choose a new password">
      {token ? (
        <ResetPasswordForm token={token} />
      ) : (
        <p>
          This page needs the link from the reset email.{' '}
          <Link className="underline underline-offset-4" to="/forgot-password">
            Ask for a new one
          </Link>
          .
        </p>
      )}
    </Page>
  )
}
