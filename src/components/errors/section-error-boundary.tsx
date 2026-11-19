import { useQueryErrorResetBoundary } from '@tanstack/react-query'
import { CatchBoundary, type ErrorComponentProps } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { ApiErrorAlert } from '#/components/errors/api-error-alert.tsx'
import { Button } from '#/components/ui/button.tsx'

function SectionError({ action, error, reset }: ErrorComponentProps & { action: string }) {
  const queryErrorResetBoundary = useQueryErrorResetBoundary()
  return (
    <div className="grid justify-items-start gap-2">
      <ApiErrorAlert action={action} error={error} />
      <Button
        onClick={() => {
          // A suspense query inside fetches again instead of rethrowing its cached error.
          queryErrorResetBoundary.reset()
          reset()
        }}
        size="sm"
        type="button"
        variant="outline"
      >
        Try again
      </Button>
    </div>
  )
}

/**
 * Contains a failure to one part of a page. When something inside throws while rendering (a suspense query with
 * nothing to show, a bug), that part says what failed and offers a retry, and the rest of the page keeps
 * working. Failures of the route's loader still reach the route's `errorComponent`. `action` completes
 * "Could not …", as in ApiErrorAlert.
 */
export function SectionErrorBoundary(props: { action: string; children: ReactNode }) {
  return (
    <CatchBoundary
      errorComponent={(error: ErrorComponentProps) => <SectionError {...error} action={props.action} />}
      getResetKey={() => props.action}
    >
      {props.children}
    </CatchBoundary>
  )
}
