import { revalidateLogic } from '@tanstack/react-form'
import { useAppForm } from '#/components/form/app-form.ts'
import { lazyFormSchema } from '#/components/form/lazy-schema.ts'
import { useRequestPasswordReset } from '#/features/auth/api/request-password-reset.ts'
import { AuthForm, useAuthFormController } from '#/features/auth/components/auth-form.tsx'
import { AuthStatus } from '#/features/auth/components/auth-status.tsx'

const schema = lazyFormSchema(() => import('#/lib/account-input.ts').then((module) => module.EmailInput))

export function ForgotPasswordForm() {
  const request = useRequestPasswordReset()
  const controller = useAuthFormController({ fieldCodes: { INVALID_EMAIL: 'email' } })
  const form = useAppForm({
    defaultValues: { email: '' },
    onSubmit: ({ value }) => controller.submitAction(() => request.mutateAsync(schema.decode(value))),
    onSubmitInvalid: controller.onSubmitInvalid,
    validationLogic: revalidateLogic(),
    validators: { onDynamic: schema.validator },
  })
  if (controller.state.status === 'succeeded' && request.variables) {
    return (
      <AuthStatus title="Check your inbox">
        If <strong>{request.variables.email}</strong> belongs to an account, we sent it a link to choose a new password.
        The link works for one hour.
      </AuthStatus>
    )
  }
  return (
    <AuthForm controller={controller} form={form} id="forgot-password" schema={schema} submitLabel="Send reset link">
      <form.AppField name="email">
        {(field) => <field.TextField autoComplete="email" id="email" label="Email" required type="email" />}
      </form.AppField>
    </AuthForm>
  )
}
