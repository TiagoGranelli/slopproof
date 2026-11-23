import { useQueryErrorResetBoundary } from '@tanstack/react-query'
import { CatchBoundary } from '@tanstack/react-router'
import type { ErrorComponentProps } from '@tanstack/react-router'
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
