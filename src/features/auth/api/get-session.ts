import { type QueryClient, queryOptions, useQueryClient } from '@tanstack/react-query'
import { useSyncExternalStore } from 'react'
import { getSession, isPrerendering, type SignedInSession } from '#/lib/session.functions.ts'

// Kept for the tab's life: sign-in, sign-out and account deletion clear the whole cache (`clearsCache`), and the
// guard of a signed-in page reads it afresh (fetchFreshSession).
const sessionQueryOptions = () =>
  queryOptions({ queryFn: () => getSession(), queryKey: ['auth', 'session'], staleTime: Number.POSITIVE_INFINITY })

/**
 * The session as the server has it now, for the `_authed` guard on every navigation to a signed-in page. The
 * answer is cached, so the site header (useSessionUser) shows it without asking again. A failure throws, and
 * reaches the error page.
 */
export function fetchFreshSession(queryClient: QueryClient): Promise<SignedInSession | null> {
  return queryClient.query({ ...sessionQueryOptions(), staleTime: 0 })
}

/**
 * Makes sure the cache holds the session, for the root route's loader. Loaders run after every guard, so on a
 * signed-in page this finds the guard's fresh answer. During SSR it is the request's one session lookup, shared
 * with the guard and the loaders' API calls (src/server/http/request-session.ts); in the browser the cache SSR
 * filled answers, so a client-side navigation makes no request for it. A page Nitro prerenders at build time has
 * no visitor and reads nothing. A failed read leaves the session unknown instead of failing the page.
 */
export async function loadSession(queryClient: QueryClient): Promise<void> {
  if (isPrerendering()) {
    return
  }
  await queryClient.query(sessionQueryOptions()).catch(() => undefined)
}

const sessionSubscribers = new WeakMap<QueryClient, (onChange: () => void) => () => void>()

/** Stable store subscriber per QueryClient: runs only after hydration, filling a prerendered page's cache once. */
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

/**
 * Who is signed in, from the cache: the user, `null` when signed out, or `undefined` while not known (a read that
 * failed, just after the cache was cleared, or a prerendered page before it asked). It follows the cache itself
 * rather than a query observer, which would keep showing a query that sign-in or sign-out cleared away. On an SSR
 * page the cache already has the answer and this asks nothing; a prerendered page had no visitor to ask for, so it
 * asks once, after hydration.
 */
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
