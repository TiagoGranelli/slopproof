import {
  type AuthFieldCodes,
  authFieldIssues,
  describeAuthFailure,
} from '#/features/auth/utils/describe-auth-failure.ts'

export type AuthFormState =
  | { readonly status: 'idle' }
  | { readonly status: 'validating' }
  | { readonly status: 'submitting' }
  | {
      readonly focusFirstInvalid: boolean
      readonly issues: Record<string, string>
      readonly status: 'field-error'
    }
  | { readonly message: string; readonly status: 'form-error' }
  | { readonly status: 'succeeded' }

export type AuthFormEvent =
  | { readonly type: 'SUBMIT_REQUESTED' }
  | { readonly message: string; readonly type: 'SCHEMA_LOAD_FAILED' }
  | { readonly type: 'VALIDATION_FAILED' }
  | { readonly type: 'VALIDATION_PASSED' }
  | { readonly type: 'SUBMIT_SUCCEEDED' }
  | { readonly error: Error; readonly fieldCodes?: AuthFieldCodes; readonly type: 'SUBMIT_FAILED' }
  | { readonly type: 'FOCUS_APPLIED' }
  | { readonly type: 'RESET' }

const authFailureState = (error: Error, fieldCodes: AuthFieldCodes = {}): AuthFormState => {
  const issues = authFieldIssues(error, fieldCodes)
  if (Object.keys(issues).length > 0) {
    return { focusFirstInvalid: true, issues, status: 'field-error' }
  }
  return { message: describeAuthFailure(error), status: 'form-error' }
}

export const initialAuthFormState = (initialError: Error | null = null, fieldCodes?: AuthFieldCodes): AuthFormState =>
  initialError ? authFailureState(initialError, fieldCodes) : { status: 'idle' }

export const isAuthFormBusy = (state: AuthFormState): boolean =>
  state.status === 'validating' || state.status === 'submitting'

const transitionIdleOrSettled = (state: AuthFormState, event: AuthFormEvent): AuthFormState => {
  switch (event.type) {
    case 'SUBMIT_REQUESTED':
      return { status: 'validating' }
    case 'RESET':
      return { status: 'idle' }
    case 'FOCUS_APPLIED':
    case 'SCHEMA_LOAD_FAILED':
    case 'SUBMIT_FAILED':
    case 'SUBMIT_SUCCEEDED':
    case 'VALIDATION_FAILED':
    case 'VALIDATION_PASSED':
      return state
  }
}

const transitionValidating = (
  state: Extract<AuthFormState, { readonly status: 'validating' }>,
  event: AuthFormEvent,
): AuthFormState => {
  switch (event.type) {
    case 'SCHEMA_LOAD_FAILED':
      return { message: event.message, status: 'form-error' }
    case 'VALIDATION_FAILED':
      return { focusFirstInvalid: true, issues: {}, status: 'field-error' }
    case 'VALIDATION_PASSED':
      return { status: 'submitting' }
    case 'RESET':
      return { status: 'idle' }
    case 'FOCUS_APPLIED':
    case 'SUBMIT_FAILED':
    case 'SUBMIT_REQUESTED':
    case 'SUBMIT_SUCCEEDED':
      return state
  }
}

const transitionSubmitting = (
  state: Extract<AuthFormState, { readonly status: 'submitting' }>,
  event: AuthFormEvent,
): AuthFormState => {
  switch (event.type) {
    case 'SUBMIT_SUCCEEDED':
      return { status: 'succeeded' }
    case 'SUBMIT_FAILED':
      return authFailureState(event.error, event.fieldCodes)
    case 'RESET':
      return { status: 'idle' }
    case 'FOCUS_APPLIED':
    case 'SCHEMA_LOAD_FAILED':
    case 'SUBMIT_REQUESTED':
    case 'VALIDATION_FAILED':
    case 'VALIDATION_PASSED':
      return state
  }
}

const transitionFieldError = (
  state: Extract<AuthFormState, { readonly status: 'field-error' }>,
  event: AuthFormEvent,
): AuthFormState => {
  switch (event.type) {
    case 'FOCUS_APPLIED':
      return state.focusFirstInvalid ? { ...state, focusFirstInvalid: false } : state
    case 'SUBMIT_REQUESTED':
      return { status: 'validating' }
    case 'RESET':
      return { status: 'idle' }
    case 'SCHEMA_LOAD_FAILED':
    case 'SUBMIT_FAILED':
    case 'SUBMIT_SUCCEEDED':
    case 'VALIDATION_FAILED':
    case 'VALIDATION_PASSED':
      return state
  }
}

export const transitionAuthForm = (state: AuthFormState, event: AuthFormEvent): AuthFormState => {
  switch (state.status) {
    case 'idle':
    case 'form-error':
    case 'succeeded':
      return transitionIdleOrSettled(state, event)
    case 'validating':
      return transitionValidating(state, event)
    case 'submitting':
      return transitionSubmitting(state, event)
    case 'field-error':
      return transitionFieldError(state, event)
  }
}
