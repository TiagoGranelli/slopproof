import { revalidateLogic } from '@tanstack/react-form'
import { useNavigate } from '@tanstack/react-router'
import { useAppForm } from '#/components/form/app-form.ts'
import { lazyFormSchema } from '#/components/form/lazy-schema.ts'
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '#/contract/limits.ts'
import { useResetPassword } from '#/features/auth/api/reset-password.ts'
import { AuthForm } from '#/features/auth/components/auth-form.tsx'

const schema = lazyFormSchema(() => import('#/lib/account-input.ts').then((module) => module.NewPasswordInput))

/**
 * Sets a new password with the token from a reset link. Every session of the account ends, so the next step is
 * signing in: the form goes to /login, which says why (a flash message).
 */
export function ResetPasswordForm(props: { token: string }) {
  const navigate = useNavigate()
  const reset = useResetPassword({
    mutationConfig: { onSuccess: () => navigate({ state: { flash: 'password-reset' }, to: '/login' }) },
  })
  const form = useAppForm({
    defaultValues: { newPassword: '' },
    onSubmit: ({ value }) => reset.mutate({ token: props.token, ...schema.decode(value) }),
    validationLogic: revalidateLogic(),
    validators: { onDynamic: schema.validator },
  })
  return (
    <AuthForm
      error={reset.error}
      fieldCodes={{ PASSWORD_TOO_LONG: 'newPassword', PASSWORD_TOO_SHORT: 'newPassword' }}
      form={form}
      id="reset-password"
      pending={reset.isPending}
      schema={schema}
      submitLabel="Set new password"
    >
      <form.AppField name="newPassword">
        {(field) => (
          <field.TextField
            autoComplete="new-password"
            hint={`At least ${PASSWORD_MIN_LENGTH} characters.`}
            id="new-password"
            label="New password"
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
