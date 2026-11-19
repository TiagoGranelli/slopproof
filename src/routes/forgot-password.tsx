import { Link, createFileRoute } from '@tanstack/react-router'
import { Page } from '#/components/layouts/page.tsx'
import { pageTitle } from '#/config/app.ts'
import { ForgotPasswordForm } from '#/features/auth/components/forgot-password-form.tsx'

export const Route = createFileRoute('/forgot-password')({
  component: ForgotPassword,
  head: () => ({ meta: [{ title: pageTitle('Forgot password') }, { name: 'robots', content: 'noindex' }] }),
  headers: () => ({ 'cache-control': 'private, no-store' }),
})

function ForgotPassword() {
  return (
    <Page description="We will email you a link to choose a new one." narrow title="Forgot your password?">
      <ForgotPasswordForm />
      <p className="text-sm text-muted-foreground">
        <Link className="underline underline-offset-4" to="/login">
          Back to sign in
        </Link>
      </p>
    </Page>
  )
}
