import { revalidateLogic } from '@tanstack/react-form'
import { useNavigate } from '@tanstack/react-router'
import { useAppForm } from '#/components/form/app-form.ts'
import { lazyFormSchema } from '#/components/form/lazy-schema.ts'
import { AuthActionError } from '#/features/auth/api/auth-action.ts'
import { useSignIn } from '#/features/auth/api/sign-in.ts'
import { AuthForm, useAuthFormController } from '#/features/auth/components/auth-form.tsx'
import { safeRedirect } from '#/features/auth/utils/safe-redirect.ts'
import { signInFromForm } from '#/lib/auth.functions.ts'
import type { AuthFailure } from '#/lib/auth.functions.ts'

const schema = lazyFormSchema(() => import('#/lib/account-input.ts').then((module) => module.SignInInput))

export function LoginForm(props: { failure?: AuthFailure; redirectTo?: string }) {
  const navigate = useNavigate()
  const signIn = useSignIn({
    mutationConfig: { onSuccess: () => navigate({ href: safeRedirect(props.redirectTo), replace: true }) },
  })
  const controller = useAuthFormController({
    initialError: props.failure ? new AuthActionError(props.failure) : null,
  })
  const form = useAppForm({
    defaultValues: { email: '', password: '' },
    onSubmit: ({ value }) => controller.submitAction(() => signIn.mutateAsync(schema.decode(value))),
    onSubmitInvalid: controller.onSubmitInvalid,
    validationLogic: revalidateLogic(),
    validators: { onDynamic: schema.validator },
  })
  return (
    <AuthForm
      action={signInFromForm.url}
      controller={controller}
      form={form}
      id="sign-in"
      schema={schema}
      submitLabel="Sign in"
    >
      <input name="redirect" type="hidden" value={props.redirectTo ?? ''} />
      <form.AppField name="email">
        {(field) => <field.TextField autoComplete="username" id="email" label="Email" required type="email" />}
      </form.AppField>
      <form.AppField name="password">
        {(field) => (
          <field.TextField autoComplete="current-password" id="password" label="Password" required type="password" />
        )}
      </form.AppField>
    </AuthForm>
  )
}
