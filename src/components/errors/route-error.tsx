import { useQueryErrorResetBoundary } from '@tanstack/react-query'
import { Link, useRouter } from '@tanstack/react-router'
import type { ErrorComponentProps } from '@tanstack/react-router'
import { ApiErrorAlert } from '#/components/errors/api-error-alert.tsx'
import { Page } from '#/components/layouts/page.tsx'
import { Button } from '#/components/ui/button.tsx'

export function RouteError({
  action = 'load this page',
  error,
  reset,
  title = 'This page could not be loaded',
}: ErrorComponentProps & { action?: string; title?: string }) {
  const router = useRouter()
  const queryErrorResetBoundary = useQueryErrorResetBoundary()
  const resetQueryBoundary = (node: HTMLDivElement | null) => {
    if (node) {
      queryErrorResetBoundary.reset()
    }
  }
  return (
    <Page title={title}>
      <ApiErrorAlert action={action} error={error} />
      <div className="flex flex-wrap gap-2" ref={resetQueryBoundary}>
        <Button
          onClick={() => {
            reset()
            void router.invalidate().catch(reportError)
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
