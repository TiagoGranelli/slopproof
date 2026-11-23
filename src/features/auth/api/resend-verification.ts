import { useAuthMutation } from '#/features/auth/api/auth-action.ts'
import type { AuthMutationConfig, DataOf } from '#/features/auth/api/auth-action.ts'
import { resendVerification } from '#/lib/auth.functions.ts'

type ResendVerificationInput = DataOf<typeof resendVerification>

export function useResendVerification({
  mutationConfig,
}: { mutationConfig?: AuthMutationConfig<ResendVerificationInput> } = {}) {
  return useAuthMutation((data: ResendVerificationInput) => resendVerification({ data }), mutationConfig)
}
