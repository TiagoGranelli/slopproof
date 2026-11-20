import { useHydrated } from '@tanstack/react-router'
import { type Dispatch, type ReactNode, useReducer } from 'react'
import { describedBy, focusFirstInvalid } from '#/components/form/field-messages.ts'
import { loadOnInteraction, SCHEMA_LOAD_FAILED } from '#/components/form/lazy-schema.ts'
import { ServerIssues } from '#/components/form/server-issues.ts'
import { Button } from '#/components/ui/button.tsx'
import {
  type AuthFormEvent,
  type AuthFormState,
  initialAuthFormState,
  isAuthFormBusy,
  transitionAuthForm,
} from '#/features/auth/utils/auth-form-machine.ts'
import type { AuthFieldCodes } from '#/features/auth/utils/describe-auth-failure.ts'

export interface AuthFormController {
  readonly dispatch: Dispatch<AuthFormEvent>
  readonly onSubmitInvalid: () => void
  readonly state: AuthFormState
  readonly submitAction: <Outcome>(run: () => Promise<Outcome>) => Promise<void>
}

const toAuthError = (error: unknown): Error =>
  error instanceof Error ? error : new Error('Authentication action failed')

export function useAuthFormController(
  options: { readonly fieldCodes?: AuthFieldCodes; readonly initialError?: Error | null } = {},
): AuthFormController {
  const [state, dispatch] = useReducer(transitionAuthForm, options.initialError ?? null, (initialError) =>
    initialAuthFormState(initialError, options.fieldCodes),
  )
  const submitAction = async <Outcome,>(run: () => Promise<Outcome>) => {
    dispatch({ type: 'VALIDATION_PASSED' })
    try {
      await run()
      dispatch({ type: 'SUBMIT_SUCCEEDED' })
    } catch (error: unknown) {
      dispatch({ error: toAuthError(error), fieldCodes: options.fieldCodes, type: 'SUBMIT_FAILED' })
    }
  }
  return { dispatch, onSubmitInvalid: () => dispatch({ type: 'VALIDATION_FAILED' }), state, submitAction }
}

const loadSchemaIfNeeded = async (schema: { load: () => Promise<void> } | undefined): Promise<boolean> =>
  schema
    ? schema
        .load()
        .then(() => true)
        .catch(() => false)
    : true

export function AuthForm(props: {
  action?: string
  children?: ReactNode
  controller: AuthFormController
  form: { handleSubmit: () => Promise<void> }
  id: string
  schema?: { load: () => Promise<void> }
  submitLabel: string
  submitVariant?: 'default' | 'destructive'
}) {
  const hydrated = useHydrated()
  const { dispatch, state } = props.controller
  const busy = isAuthFormBusy(state)
  const issues = state.status === 'field-error' ? state.issues : {}
  const formErrorMessage = state.status === 'form-error' ? state.message : null
  const errorId = `${props.id}-error`

  const focusInvalid = (element: HTMLFormElement | null) => {
    if (!element) {
      return
    }
    focusFirstInvalid(element)
    dispatch({ type: 'FOCUS_APPLIED' })
  }

  const runSubmit = async () => {
    if (busy) {
      return
    }
    dispatch({ type: 'SUBMIT_REQUESTED' })
    if (!(await loadSchemaIfNeeded(props.schema))) {
      dispatch({ message: SCHEMA_LOAD_FAILED, type: 'SCHEMA_LOAD_FAILED' })
      return
    }
    await props.form.handleSubmit()
  }

  return (
    <form
      action={props.action}
      aria-busy={busy}
      aria-describedby={describedBy(formErrorMessage && errorId)}
      className="grid gap-3"
      method="post"
      noValidate={hydrated}
      onSubmit={(event) => {
        event.preventDefault()
        void runSubmit()
      }}
      ref={state.status === 'field-error' && state.focusFirstInvalid ? focusInvalid : undefined}
      {...(props.schema ? loadOnInteraction(props.schema) : {})}
    >
      <ServerIssues value={issues}>{props.children}</ServerIssues>
      <div>
        <Button
          aria-disabled={busy || undefined}
          disabled={!hydrated && props.action === undefined}
          type="submit"
          variant={props.submitVariant}
        >
          {props.submitLabel}
        </Button>
      </div>
      {formErrorMessage ? (
        <p className="text-sm text-destructive" id={errorId} role="alert">
          {formErrorMessage}
        </p>
      ) : null}
    </form>
  )
}
