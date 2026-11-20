import { type QueryClient, queryOptions, useQueryClient } from '@tanstack/react-query'
import { useSyncExternalStore } from 'react'
import { getSession, isPrerendering, type SignedInSession } from '#/lib/session.functions.ts'

const sessionQueryOptions = () =>
  queryOptions({ queryFn: () => getSession(), queryKey: ['auth', 'session'], staleTime: Number.POSITIVE_INFINITY })

export function fetchFreshSession(queryClient: QueryClient): Promise<SignedInSession | null> {
  return queryClient.query({ ...sessionQueryOptions(), staleTime: 0 })
}

export async function loadSession(queryClient: QueryClient): Promise<void> {
  if (isPrerendering()) {
    return
  }
  await queryClient.query(sessionQueryOptions()).catch(() => undefined)
}

const sessionSubscribers = new WeakMap<QueryClient, (onChange: () => void) => () => void>()

const subscribeToSession = (queryClient: QueryClient) => {
  const existing = sessionSubscribers.get(queryClient)
  if (existing) {
    return existing
  }
  const subscribe = (onChange: () => void) => {
    const unsubscribe = queryClient.getQueryCache().subscribe(onChange)
    void loadSession(queryClient)
    return unsubscribe
  }
  sessionSubscribers.set(queryClient, subscribe)
  return subscribe
}

export function useSessionUser() {
  const queryClient = useQueryClient()
  const { queryKey } = sessionQueryOptions()
  const read = () => queryClient.getQueryData(queryKey)
  const session = useSyncExternalStore(subscribeToSession(queryClient), read, read)
  if (session === undefined) {
    return undefined
  }
  return session === null ? null : session.user
}
