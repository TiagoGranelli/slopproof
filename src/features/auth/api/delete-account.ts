import { useAuthMutation } from '#/features/auth/api/auth-action.ts'
import type { AuthMutationConfig, DataOf } from '#/features/auth/api/auth-action.ts'
import { deleteAccount } from '#/lib/auth.functions.ts'

type DeleteAccountInput = DataOf<typeof deleteAccount>

export function useDeleteAccount({ mutationConfig }: { mutationConfig?: AuthMutationConfig<DeleteAccountInput> } = {}) {
  return useAuthMutation((data: DeleteAccountInput) => deleteAccount({ data }), mutationConfig, { clearsCache: true })
}
