import { revalidateLogic } from '@tanstack/react-form'
import { useAppForm } from '#/components/form/app-form.ts'
import { lazyFormSchema } from '#/components/form/lazy-schema.ts'
import { useResendVerification } from '#/features/auth/api/resend-verification.ts'
import { AuthForm, useAuthFormController } from '#/features/auth/components/auth-form.tsx'
import { AuthStatus } from '#/features/auth/components/auth-status.tsx'

const schema = lazyFormSchema(() => import('#/lib/account-input.ts').then((module) => module.EmailInput))

export function ResendVerificationForm() {
  const resend = useResendVerification()
  const controller = useAuthFormController({ fieldCodes: { INVALID_EMAIL: 'email' } })
  const form = useAppForm({
    defaultValues: { email: '' },
    onSubmit: ({ value }) => controller.submitAction(() => resend.mutateAsync(schema.decode(value))),
    onSubmitInvalid: controller.onSubmitInvalid,
    validationLogic: revalidateLogic(),
    validators: { onDynamic: schema.validator },
  })
  if (controller.state.status === 'succeeded' && resend.variables) {
    return (
      <AuthStatus title="Check your inbox">
        If <strong>{resend.variables.email}</strong> has an account waiting for confirmation, we sent it a new link.
      </AuthStatus>
    )
  }
  return (
    <AuthForm
      controller={controller}
      form={form}
      id="resend-verification"
      schema={schema}
      submitLabel="Send a new link"
    >
      <form.AppField name="email">
        {(field) => <field.TextField autoComplete="email" id="email" label="Email" required type="email" />}
      </form.AppField>
    </AuthForm>
  )
}
