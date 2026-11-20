import { revalidateLogic } from '@tanstack/react-form'
import { useAppForm } from '#/components/form/app-form.ts'
import { lazyFormSchema } from '#/components/form/lazy-schema.ts'
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '#/contract/limits.ts'
import { useSignUp } from '#/features/auth/api/sign-up.ts'
import { AuthForm, useAuthFormController } from '#/features/auth/components/auth-form.tsx'
import { AuthStatus } from '#/features/auth/components/auth-status.tsx'

const schema = lazyFormSchema(() => import('#/lib/account-input.ts').then((module) => module.SignUpInput))

const FIELD_CODES = { INVALID_EMAIL: 'email', PASSWORD_TOO_LONG: 'password', PASSWORD_TOO_SHORT: 'password' } as const

export function SignUpForm() {
  const signUp = useSignUp()
  const controller = useAuthFormController({ fieldCodes: FIELD_CODES })
  const form = useAppForm({
    defaultValues: { email: '', name: '', password: '' },
    onSubmit: ({ value }) => controller.submitAction(() => signUp.mutateAsync(schema.decode(value))),
    onSubmitInvalid: controller.onSubmitInvalid,
    validationLogic: revalidateLogic(),
    validators: { onDynamic: schema.validator },
  })
  if (controller.state.status === 'succeeded' && signUp.variables) {
    return (
      <AuthStatus title="Confirm your email">
        Check your inbox at <strong>{signUp.variables.email}</strong>: open the link we sent to confirm your address,
        then sign in.
      </AuthStatus>
    )
  }
  return (
    <AuthForm controller={controller} form={form} id="sign-up" schema={schema} submitLabel="Create account">
      <form.AppField name="name">
        {(field) => <field.TextField autoComplete="name" id="name" label="Name" maxLength={100} required />}
      </form.AppField>
      <form.AppField name="email">
        {(field) => <field.TextField autoComplete="email" id="email" label="Email" required type="email" />}
      </form.AppField>
      <form.AppField name="password">
        {(field) => (
          <field.TextField
            autoComplete="new-password"
            hint={`At least ${PASSWORD_MIN_LENGTH} characters.`}
            id="password"
            label="Password"
            maxLength={PASSWORD_MAX_LENGTH}
            minLength={PASSWORD_MIN_LENGTH}
            required
            type="password"
          />
        )}
      </form.AppField>
    </AuthForm>
  )
}
