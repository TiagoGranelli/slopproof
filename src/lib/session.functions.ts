import { createIsomorphicFn, createServerFn } from '@tanstack/react-start'
import { getRequestHeaders, setResponseHeader } from '@tanstack/react-start/server'
import { requestSession } from '#/server/http/request-session.ts'

export type SignedInSession = {
  readonly user: { readonly email: string; readonly emailVerified: boolean; readonly id: string; readonly name: string }
}

export const getSession = createServerFn({ method: 'GET' }).handler(async (): Promise<SignedInSession | null> => {
  setResponseHeader('cache-control', 'private, no-store')
  const session = await requestSession(getRequestHeaders())
  if (!session) {
    return null
  }
  const { email, emailVerified, id, name } = session.user
  return { user: { email, emailVerified, id, name } }
})

export const isPrerendering = createIsomorphicFn()
  .server((): boolean => getRequestHeaders().has('x-nitro-prerender'))
  .client((): boolean => false)
