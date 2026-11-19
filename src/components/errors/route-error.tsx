import { useQueryErrorResetBoundary } from '@tanstack/react-query'
import { type ErrorComponentProps, Link, useRouter } from '@tanstack/react-router'
import { useEffect } from 'react'
import { ApiErrorAlert } from '#/components/errors/api-error-alert.tsx'
import { Page } from '#/components/layouts/page.tsx'
import { Button } from '#/components/ui/button.tsx'

/**
 * Router `defaultErrorComponent`: a loader, `beforeLoad` or suspense query failed (SSR or client). A route can
 * name what failed in its own `errorComponent`: `title` is the heading, `action` completes "Could not …".
 */
export function RouteError({
  action = 'load this page',
  error,
  reset,
  title = 'This page could not be loaded',
}: ErrorComponentProps & { action?: string; title?: string }) {
  const router = useRouter()
  const queryErrorResetBoundary = useQueryErrorResetBoundary()
  // Lets useSuspenseQuery retry instead of rethrowing the cached error when the route renders again.
  useEffect(() => {
    queryErrorResetBoundary.reset()
  }, [queryErrorResetBoundary])
  return (
    <Page title={title}>
      <ApiErrorAlert action={action} error={error} />
      <div className="flex flex-wrap gap-2">
        <Button
          onClick={async () => {
            reset()
            await router.invalidate()
          }}
          type="button"
        >
          Try again
        </Button>
        <Button asChild variant="outline">
          <Link to="/">Go to the home page</Link>
        </Button>
      </div>
    </Page>
  )
}
