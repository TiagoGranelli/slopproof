import { revalidateLogic } from '@tanstack/react-form'
import { useNavigate } from '@tanstack/react-router'
import { useAppForm } from '#/components/form/app-form.ts'
import { lazyFormSchema } from '#/components/form/lazy-schema.ts'
import { AuthActionError } from '#/features/auth/api/auth-action.ts'
import { useSignIn } from '#/features/auth/api/sign-in.ts'
import { AuthForm } from '#/features/auth/components/auth-form.tsx'
import { safeRedirect } from '#/features/auth/utils/safe-redirect.ts'
import { type AuthFailure, signInFromForm } from '#/lib/auth.functions.ts'

const schema = lazyFormSchema(() => import('#/lib/account-input.ts').then((module) => module.SignInInput))

/**
 * Email and password sign-in. On success it goes to `redirectTo` if that is a safe same-origin path. It also
 * works before hydration and without JavaScript: the browser posts it to signInFromForm, which answers with a
 * redirect back to /login, and a failure arrives here as `failure` (from the URL).
 */
export function LoginForm(props: { failure?: AuthFailure; redirectTo?: string }) {
  const navigate = useNavigate()
  const signIn = useSignIn({
    mutationConfig: { onSuccess: () => navigate({ href: safeRedirect(props.redirectTo), replace: true }) },
  })
  const form = useAppForm({
    defaultValues: { email: '', password: '' },
    onSubmit: ({ value }) => signIn.mutate(schema.decode(value)),
    validationLogic: revalidateLogic(),
    validators: { onDynamic: schema.validator },
  })
  // The failure of a post without JavaScript, until the script's own first attempt.
  const postedFailure = signIn.isIdle && props.failure ? new AuthActionError(props.failure) : null
  return (
    <AuthForm
      action={signInFromForm.url}
      error={signIn.error ?? postedFailure}
      form={form}
      id="sign-in"
      pending={signIn.isPending}
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
