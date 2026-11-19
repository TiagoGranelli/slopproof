import { revalidateLogic } from '@tanstack/react-form'
import { useAppForm } from '#/components/form/app-form.ts'
import { lazyFormSchema } from '#/components/form/lazy-schema.ts'
import { useRequestPasswordReset } from '#/features/auth/api/request-password-reset.ts'
import { AuthForm } from '#/features/auth/components/auth-form.tsx'
import { AuthStatus } from '#/features/auth/components/auth-status.tsx'

const schema = lazyFormSchema(() => import('#/lib/account-input.ts').then((module) => module.EmailInput))

/** Asks for a reset link. The answer does not reveal whether the address has an account. */
export function ForgotPasswordForm() {
  const request = useRequestPasswordReset()
  const form = useAppForm({
    defaultValues: { email: '' },
    onSubmit: ({ value }) => request.mutate(schema.decode(value)),
    validationLogic: revalidateLogic(),
    validators: { onDynamic: schema.validator },
  })
  if (request.isSuccess) {
    return (
      <AuthStatus title="Check your inbox">
        If <strong>{request.variables.email}</strong> belongs to an account, we sent it a link to choose a new password.
        The link works for one hour.
      </AuthStatus>
    )
  }
  return (
    <AuthForm
      error={request.error}
      fieldCodes={{ INVALID_EMAIL: 'email' }}
      form={form}
      id="forgot-password"
      pending={request.isPending}
      schema={schema}
      submitLabel="Send reset link"
    >
      <form.AppField name="email">
        {(field) => <field.TextField autoComplete="email" id="email" label="Email" required type="email" />}
      </form.AppField>
    </AuthForm>
  )
}
