import { type AuthMutationConfig, type DataOf, useAuthMutation } from '#/features/auth/api/auth-action.ts'
import { resetPassword } from '#/lib/auth.functions.ts'

type ResetPasswordInput = DataOf<typeof resetPassword>

export function useResetPassword({ mutationConfig }: { mutationConfig?: AuthMutationConfig<ResetPasswordInput> } = {}) {
  return useAuthMutation((data: ResetPasswordInput) => resetPassword({ data }), mutationConfig, { clearsCache: true })
}
