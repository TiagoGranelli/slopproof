export function fieldErrorMessage(errors: ReadonlyArray<unknown>): string | undefined {
  for (const error of errors) {
    if (typeof error === 'string' && error) {
      return error
    }
    if (typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string') {
      return error.message
    }
  }
  return undefined
}

export const describedBy = (...ids: ReadonlyArray<string | false | null | undefined>) =>
  ids.filter((id) => typeof id === 'string' && id !== '').join(' ') || undefined

export const focusFirstInvalid = (form: HTMLFormElement) => {
  form.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()
}
