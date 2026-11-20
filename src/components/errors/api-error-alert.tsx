import { Link, useLocation } from '@tanstack/react-router'
import { describeApiError } from '#/lib/api-error.ts'

export function ApiErrorAlert(props: { action: string; error: unknown; id?: string }) {
  const href = useLocation({ select: (location) => location.href })
  const { message, signIn } = describeApiError(props.error, props.action)
  return (
    <p className="text-sm text-destructive" id={props.id} role="alert">
      {message}
      {signIn ? (
        <>
          {' '}
          <Link className="font-medium underline underline-offset-4" search={{ redirect: href }} to="/login">
            Sign in
          </Link>
        </>
      ) : null}
    </p>
  )
}
