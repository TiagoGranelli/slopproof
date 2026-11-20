import { type AuthMutationConfig, type DataOf, useAuthMutation } from '#/features/auth/api/auth-action.ts'
import { verifyEmail } from '#/lib/auth.functions.ts'

type VerifyEmailInput = DataOf<typeof verifyEmail>

export function useVerifyEmail({ mutationConfig }: { mutationConfig?: AuthMutationConfig<VerifyEmailInput> } = {}) {
  return useAuthMutation((data: VerifyEmailInput) => verifyEmail({ data }), mutationConfig)
}
