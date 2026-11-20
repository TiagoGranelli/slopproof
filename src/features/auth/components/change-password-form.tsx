import { revalidateLogic } from '@tanstack/react-form'
import { useAppForm } from '#/components/form/app-form.ts'
import { lazyFormSchema } from '#/components/form/lazy-schema.ts'
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '#/contract/limits.ts'
import { useChangePassword } from '#/features/auth/api/change-password.ts'
import { AuthForm, useAuthFormController } from '#/features/auth/components/auth-form.tsx'
import { AuthStatus } from '#/features/auth/components/auth-status.tsx'

const schema = lazyFormSchema(() => import('#/lib/account-input.ts').then((module) => module.ChangePasswordInput))

const FIELD_CODES = {
  INVALID_PASSWORD: 'currentPassword',
  PASSWORD_TOO_LONG: 'newPassword',
  PASSWORD_TOO_SHORT: 'newPassword',
} as const

/** Changes the password. Every other session of the account is signed out; this one continues. */
export function ChangePasswordForm() {
  const change = useChangePassword({ mutationConfig: { onSuccess: () => form.reset() } })
  const controller = useAuthFormController({ fieldCodes: FIELD_CODES })
  const form = useAppForm({
    defaultValues: { currentPassword: '', newPassword: '' },
    onSubmit: ({ value }) => controller.submitAction(() => change.mutateAsync(schema.decode(value))),
    onSubmitInvalid: controller.onSubmitInvalid,
    validationLogic: revalidateLogic(),
    validators: { onDynamic: schema.validator },
  })
  return (
    <div className="grid gap-3">
      <AuthForm controller={controller} form={form} id="change-password" schema={schema} submitLabel="Change password">
        <form.AppField name="currentPassword">
          {(field) => (
            <field.TextField
              autoComplete="current-password"
              id="current-password"
              label="Current password"
              required
              type="password"
            />
          )}
        </form.AppField>
        <form.AppField name="newPassword">
          {(field) => (
            <field.TextField
              autoComplete="new-password"
              hint={`At least ${PASSWORD_MIN_LENGTH} characters. Your other sessions will be signed out.`}
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
      {/* The emptied form keeps no focus of its own, so the message takes it. */}
      {controller.state.status === 'succeeded' ? (
        <AuthStatus headingLevel={3} title="Password changed">
          Your other sessions were signed out.
        </AuthStatus>
      ) : null}
    </div>
  )
}
