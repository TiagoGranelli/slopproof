import { type AuthMutationConfig, useAuthMutation } from '#/features/auth/api/auth-action.ts'
import { signOut } from '#/lib/auth.functions.ts'

export function useSignOut({ mutationConfig }: { mutationConfig?: AuthMutationConfig<void> } = {}) {
  return useAuthMutation(() => signOut(), mutationConfig, { clearsCache: true })
}
