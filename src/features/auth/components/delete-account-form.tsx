import { revalidateLogic } from '@tanstack/react-form'
import { useNavigate } from '@tanstack/react-router'
import { useAppForm } from '#/components/form/app-form.ts'
import { lazyFormSchema } from '#/components/form/lazy-schema.ts'
import { useDeleteAccount } from '#/features/auth/api/delete-account.ts'
import { AuthForm } from '#/features/auth/components/auth-form.tsx'

const schema = lazyFormSchema(() => import('#/lib/account-input.ts').then((module) => module.DeleteAccountFields))

/**
 * Deletes the account and everything it owns. Two confirmations: the password (checked by Better Auth) and an explicit
 * checkbox, so neither a stray click nor an unattended signed-in browser is enough.
 */
export function DeleteAccountForm() {
  const navigate = useNavigate()
  const remove = useDeleteAccount({
    mutationConfig: { onSuccess: () => navigate({ replace: true, state: { flash: 'account-deleted' }, to: '/' }) },
  })
  const form = useAppForm({
    defaultValues: { confirm: false, password: '' },
    onSubmit: ({ value }) => remove.mutate({ password: value.password }),
    validationLogic: revalidateLogic(),
    validators: { onDynamic: schema.validator },
  })
  return (
    <AuthForm
      error={remove.error}
      fieldCodes={{ INVALID_PASSWORD: 'password' }}
      form={form}
      id="delete-account"
      pending={remove.isPending}
      schema={schema}
      submitLabel="Delete account"
      submitVariant="destructive"
    >
      <form.AppField name="password">
        {(field) => (
          <field.TextField
            autoComplete="current-password"
            id="delete-password"
            label="Password"
            required
            type="password"
          />
        )}
      </form.AppField>
      <form.AppField name="confirm">
        {(field) => (
          <field.CheckboxField
            className="mt-0.5 size-4 accent-destructive"
            id="delete-confirm"
            label="I understand that my account and all its data are deleted for good."
            required
          />
        )}
      </form.AppField>
    </AuthForm>
  )
}
