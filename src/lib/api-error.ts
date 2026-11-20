import type { RateLimited, ValidationError } from '#/contract/errors.ts'
import type * as Sdk from '#/sdk/sdk.gen.ts'

type ErrorBody<Result> = Result extends { error: infer E } ? E : never
type ErrorOf<F> = F extends (...args: Array<never>) => infer R ? ErrorBody<Awaited<R>> : never

type MiddlewareError = (typeof ValidationError)['Encoded'] | (typeof RateLimited)['Encoded']

type TaggedApiError =
  | {
      [Fn in keyof typeof Sdk]: Extract<ErrorOf<(typeof Sdk)[Fn]>, { _tag: string }>
    }[keyof typeof Sdk]
  | MiddlewareError

interface ApiErrorView {
  readonly message: string
  readonly signIn: boolean
}

const isTaggedApiError = (error: unknown): error is TaggedApiError =>
  typeof error === 'object' && error !== null && '_tag' in error && typeof error._tag === 'string'

export const apiErrorTag = (error: unknown): TaggedApiError['_tag'] | undefined =>
  isTaggedApiError(error) ? error._tag : undefined

export function fieldIssue(error: unknown, field: string): string | undefined {
  if (!isTaggedApiError(error) || error._tag !== 'ValidationError') {
    return undefined
  }
  return error.issues.find((issue) => issue.path[0] === field)?.message
}

type Describe<Tag extends TaggedApiError['_tag']> = (
  error: Extract<TaggedApiError, { _tag: Tag }>,
  action: string,
) => ApiErrorView

const DESCRIBE_TAG = {
  PostNotFound: () => ({ message: 'This post no longer exists. It may have been deleted elsewhere.', signIn: false }),
  RateLimited: (error, action) => ({
    message: `Could not ${action}: too many changes in a short time. Try again in ${error.retryAfter} second${error.retryAfter === 1 ? '' : 's'}.`,
    signIn: false,
  }),
  ServiceUnavailable: () => ({
    message: 'The service is temporarily unavailable. Try again in a moment.',
    signIn: false,
  }),
  Unauthorized: () => ({ message: 'Your session has ended. Sign in again to continue.', signIn: true }),
  ValidationError: (error, action) => {
    const details = error.issues.map((issue) => issue.message).join(' ')
    return { message: `Could not ${action}: ${details || error.message}`, signIn: false }
  },
} satisfies { readonly [Tag in TaggedApiError['_tag']]: Describe<Tag> }

export function describeApiError(error: unknown, action: string): ApiErrorView {
  if (error instanceof TypeError) {
    return { message: `Could not ${action}. Check your connection and try again.`, signIn: false }
  }
  if (!isTaggedApiError(error) || !Object.hasOwn(DESCRIBE_TAG, error._tag)) {
    return { message: `Could not ${action}. Try again.`, signIn: false }
  }
  const describe = DESCRIBE_TAG[error._tag] as Describe<TaggedApiError['_tag']>
  return describe(error, action)
}
