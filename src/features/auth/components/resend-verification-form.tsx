import { revalidateLogic } from '@tanstack/react-form'
import { useAppForm } from '#/components/form/app-form.ts'
import { lazyFormSchema } from '#/components/form/lazy-schema.ts'
import { useResendVerification } from '#/features/auth/api/resend-verification.ts'
import { AuthForm } from '#/features/auth/components/auth-form.tsx'
import { AuthStatus } from '#/features/auth/components/auth-status.tsx'

const schema = lazyFormSchema(() => import('#/lib/account-input.ts').then((module) => module.EmailInput))

/** Asks for a new confirmation link. The answer does not reveal whether the address has an account. */
export function ResendVerificationForm() {
  const resend = useResendVerification()
  const form = useAppForm({
    defaultValues: { email: '' },
    onSubmit: ({ value }) => resend.mutate(schema.decode(value)),
    validationLogic: revalidateLogic(),
    validators: { onDynamic: schema.validator },
  })
  if (resend.isSuccess) {
    return (
      <AuthStatus title="Check your inbox">
        If <strong>{resend.variables.email}</strong> has an account waiting for confirmation, we sent it a new link.
      </AuthStatus>
    )
  }
  return (
    <AuthForm
      error={resend.error}
      fieldCodes={{ INVALID_EMAIL: 'email' }}
      form={form}
      id="resend-verification"
      pending={resend.isPending}
      schema={schema}
      submitLabel="Send a new link"
    >
      <form.AppField name="email">
        {(field) => <field.TextField autoComplete="email" id="email" label="Email" required type="email" />}
      </form.AppField>
    </AuthForm>
  )
}
