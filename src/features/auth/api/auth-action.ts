import { useMutation } from '@tanstack/react-query'
import type { MutationMeta, UseMutationOptions } from '@tanstack/react-query'
import type { AuthFailure, AuthFailureCode, AuthOutcome } from '#/lib/auth.functions.ts'

export class AuthActionError extends Error {
  readonly code: AuthFailureCode
  readonly retryAfter: number | undefined

  constructor(failure: AuthFailure) {
    super(failure.code)
    this.name = 'AuthActionError'
    this.code = failure.code
    this.retryAfter = failure.retryAfter
  }
}

const unwrap = <T>(outcome: AuthOutcome<T>): T => {
  if (!outcome.ok) {
    throw new AuthActionError(outcome.failure)
  }
  return outcome.value
}

export type DataOf<F extends (options: { data: never }) => object> = Parameters<F>[0]['data']

export type AuthMutationConfig<TInput, TOutput = null> = Omit<UseMutationOptions<TOutput, Error, TInput>, 'mutationFn'>

export function useAuthMutation<TInput, TOutput>(
  action: (input: TInput) => Promise<AuthOutcome<TOutput>>,
  config: AuthMutationConfig<TInput, TOutput> | undefined,
  effects: MutationMeta = {},
) {
  return useMutation({
    ...config,
    meta: effects,
    mutationFn: async (input: TInput) => unwrap(await action(input)),
  })
}
