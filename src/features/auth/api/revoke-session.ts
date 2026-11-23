import { useAuthMutation } from '#/features/auth/api/auth-action.ts'
import type { AuthMutationConfig, DataOf } from '#/features/auth/api/auth-action.ts'
import { sessionsQueryKey } from '#/features/auth/api/get-sessions.ts'
import { revokeSession } from '#/lib/auth.functions.ts'

type RevokeSessionInput = DataOf<typeof revokeSession>

export function useRevokeSession({ mutationConfig }: { mutationConfig?: AuthMutationConfig<RevokeSessionInput> } = {}) {
  return useAuthMutation((data: RevokeSessionInput) => revokeSession({ data }), mutationConfig, {
    invalidates: [{ queryKey: sessionsQueryKey }],
  })
}
