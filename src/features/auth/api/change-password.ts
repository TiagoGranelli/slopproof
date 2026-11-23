import { useAuthMutation } from '#/features/auth/api/auth-action.ts'
import type { AuthMutationConfig, DataOf } from '#/features/auth/api/auth-action.ts'
import { sessionsQueryKey } from '#/features/auth/api/get-sessions.ts'
import { changePassword } from '#/lib/auth.functions.ts'

type ChangePasswordInput = DataOf<typeof changePassword>

export function useChangePassword({
  mutationConfig,
}: { mutationConfig?: AuthMutationConfig<ChangePasswordInput> } = {}) {
  return useAuthMutation((data: ChangePasswordInput) => changePassword({ data }), mutationConfig, {
    invalidates: [{ queryKey: sessionsQueryKey }],
  })
}
