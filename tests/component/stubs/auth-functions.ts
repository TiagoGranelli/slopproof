import type { Json } from '#/contract/json.ts'
import type * as AuthFunctions from '#/lib/auth.functions.ts'

export type AuthFunctionName = keyof typeof AuthFunctions

export const authFunctionPath = (name: AuthFunctionName) => `/_serverFn/auth/${name}`

const serverFunction = (name: AuthFunctionName) =>
  Object.assign(
    async (options?: { data?: Json }): Promise<Json> => {
      const res = await fetch(authFunctionPath(name), {
        body: JSON.stringify(options?.data ?? null),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      })
      if (!res.ok) {
        throw new Error(`server function ${name} failed with ${res.status}`)
      }
      return (await res.json()) as Json
    },
    { url: authFunctionPath(name) },
  )

export const getSignUpPolicy = serverFunction('getSignUpPolicy')
export const signIn = serverFunction('signIn')
export const signInFromForm = serverFunction('signInFromForm')
export const signOut = serverFunction('signOut')
export const signUp = serverFunction('signUp')
export const resendVerification = serverFunction('resendVerification')
export const verifyEmail = serverFunction('verifyEmail')
export const requestPasswordReset = serverFunction('requestPasswordReset')
export const resetPassword = serverFunction('resetPassword')
export const changePassword = serverFunction('changePassword')
export const listSessions = serverFunction('listSessions')
export const revokeSession = serverFunction('revokeSession')
export const revokeOtherSessions = serverFunction('revokeOtherSessions')
export const signOutEverywhere = serverFunction('signOutEverywhere')
export const deleteAccount = serverFunction('deleteAccount')
