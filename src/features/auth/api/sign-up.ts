import { type AuthMutationConfig, type DataOf, useAuthMutation } from '#/features/auth/api/auth-action.ts'
import { signUp } from '#/lib/auth.functions.ts'

type SignUpInput = DataOf<typeof signUp>

export function useSignUp({ mutationConfig }: { mutationConfig?: AuthMutationConfig<SignUpInput> } = {}) {
  return useAuthMutation((data: SignUpInput) => signUp({ data }), mutationConfig)
}
