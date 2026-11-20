import { Link } from '@tanstack/react-router'
import { useAppForm } from '#/components/form/app-form.ts'
import { useVerifyEmail } from '#/features/auth/api/verify-email.ts'
import { AuthForm, useAuthFormController } from '#/features/auth/components/auth-form.tsx'
import { AuthStatus } from '#/features/auth/components/auth-status.tsx'
import { ResendVerificationForm } from '#/features/auth/components/resend-verification-form.tsx'

/**
 * Confirms the address of a confirmation link, but only when its owner presses the button: opening the link
 * (a GET, which mail scanners and link previews also make) changes nothing. Signing in stays a separate step.
 */
export function VerifyEmailForm(props: { token: string }) {
  const verify = useVerifyEmail()
  const controller = useAuthFormController()
  // No fields: the token comes from the link.
  const form = useAppForm({
    defaultValues: {},
    onSubmit: () => controller.submitAction(() => verify.mutateAsync({ token: props.token })),
    onSubmitInvalid: controller.onSubmitInvalid,
  })
  if (controller.state.status === 'succeeded') {
    return (
      <AuthStatus title="Email confirmed">
        Your email address is confirmed.{' '}
        <Link className="underline underline-offset-4" to="/login">
          Sign in
        </Link>{' '}
        to continue.
      </AuthStatus>
    )
  }
  return (
    <>
      <AuthForm controller={controller} form={form} id="verify-email" submitLabel="Confirm email">
        <p>Confirm that this address is yours to finish setting up your account.</p>
      </AuthForm>
      {controller.state.status === 'form-error' || controller.state.status === 'field-error' ? (
        <ResendVerificationForm />
      ) : null}
    </>
  )
}
