import '@tanstack/react-start/server-only'
import { getRequest } from '@tanstack/react-start/server'
import { auth } from '../auth.ts'

type Session = Awaited<ReturnType<typeof auth.api.getSession>>

const lookups = new WeakMap<Request, Map<string, Promise<Session>>>()

const incomingRequest = (): Request | undefined => {
  try {
    return getRequest()
  } catch {
    return undefined
  }
}

export const requestSession = (headers: Headers): Promise<Session> => {
  const request = incomingRequest()
  if (!request) {
    return auth.api.getSession({ headers })
  }
  const cookie = headers.get('cookie') ?? ''
  let byCookie = lookups.get(request)
  if (!byCookie) {
    byCookie = new Map()
    lookups.set(request, byCookie)
  }
  let session = byCookie.get(cookie)
  if (!session) {
    session = auth.api.getSession({ headers })
    byCookie.set(cookie, session)
  }
  return session
}
