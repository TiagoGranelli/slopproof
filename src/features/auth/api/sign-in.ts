import { type AuthMutationConfig, type DataOf, useAuthMutation } from '#/features/auth/api/auth-action.ts'
import { signIn } from '#/lib/auth.functions.ts'

type SignInInput = DataOf<typeof signIn>

export function useSignIn({ mutationConfig }: { mutationConfig?: AuthMutationConfig<SignInInput> } = {}) {
  return useAuthMutation((data: SignInInput) => signIn({ data }), mutationConfig, { clearsCache: true })
}
