import { Link, createFileRoute, redirect } from '@tanstack/react-router'
import { Page } from '#/components/layouts/page.tsx'
import { pageTitle } from '#/config/app.ts'
import { LoginForm } from '#/features/auth/components/login-form.tsx'
import { failureFromSearch } from '#/features/auth/utils/describe-auth-failure.ts'
import { safeRedirect } from '#/features/auth/utils/safe-redirect.ts'
import { type AuthFailureCode, getSignUpPolicy } from '#/lib/auth.functions.ts'
import { getSession } from '#/lib/session.functions.ts'

const link = 'underline underline-offset-4'

interface LoginSearch {
  /** A failed post without JavaScript (signInFromForm): a known failure code, and the wait it may carry. */
  error?: AuthFailureCode
  /** Set by the _authed guard. Anything that is not a same-origin path becomes /dashboard. */
  redirect?: string
  retryAfter?: number
}

export const Route = createFileRoute('/login')({
  validateSearch: (search: {
    readonly error?: unknown
    readonly redirect?: unknown
    readonly retryAfter?: unknown
  }): LoginSearch => {
    const login: LoginSearch = failureFromSearch(search)
    if (typeof search.redirect === 'string') {
      login.redirect = safeRedirect(search.redirect)
    }
    return login
  },
  // Asks the server, not client state: a signed-in visitor goes straight to where they were headed.
  beforeLoad: async ({ search }) => {
    if (await getSession()) {
      throw redirect({ href: safeRedirect(search.redirect) })
    }
  },
  component: Login,
  loader: () => getSignUpPolicy(),
  head: () => ({ meta: [{ title: pageTitle('Sign in') }, { name: 'robots', content: 'noindex' }] }),
  headers: () => ({ 'cache-control': 'private, no-store' }),
})

function Login() {
  const { error, redirect: target, retryAfter } = Route.useSearch()
  const signUp = Route.useLoaderData()
  return (
    <Page narrow title="Sign in">
      <LoginForm failure={error ? { code: error, retryAfter } : undefined} redirectTo={target} />
      <div className="grid gap-2 text-sm text-muted-foreground">
        <p>
          <Link className={link} to="/forgot-password">
            Forgot your password?
          </Link>
        </p>
        {signUp.open ? (
          <p>
            No account yet?{' '}
            <Link className={link} to="/sign-up">
              Create one
            </Link>
            .
          </p>
        ) : null}
      </div>
    </Page>
  )
}
