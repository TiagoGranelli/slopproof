import { type AuthMutationConfig, useAuthMutation } from '#/features/auth/api/auth-action.ts'
import { signOutEverywhere } from '#/lib/auth.functions.ts'

export function useSignOutEverywhere({ mutationConfig }: { mutationConfig?: AuthMutationConfig<void> } = {}) {
  return useAuthMutation(() => signOutEverywhere(), mutationConfig, { clearsCache: true })
}
