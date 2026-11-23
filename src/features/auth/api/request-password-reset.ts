import { useAuthMutation } from '#/features/auth/api/auth-action.ts'
import type { AuthMutationConfig, DataOf } from '#/features/auth/api/auth-action.ts'
import { requestPasswordReset } from '#/lib/auth.functions.ts'

type RequestPasswordResetInput = DataOf<typeof requestPasswordReset>

export function useRequestPasswordReset({
  mutationConfig,
}: { mutationConfig?: AuthMutationConfig<RequestPasswordResetInput> } = {}) {
  return useAuthMutation((data: RequestPasswordResetInput) => requestPasswordReset({ data }), mutationConfig)
}
