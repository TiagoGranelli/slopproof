import { createRouter } from '@tanstack/react-router'
import { setupRouterSsrQueryIntegration } from '@tanstack/react-router-ssr-query'
import { createIsomorphicFn } from '@tanstack/react-start'
import { RouteError } from '#/components/errors/route-error.tsx'
import { RouteNotFound } from '#/components/errors/route-not-found.tsx'
import { RoutePending } from '#/components/layouts/route-pending.tsx'
import { createQueryClient } from '#/lib/query-client.ts'
import { isPrerendering } from '#/lib/session.functions.ts'
import { routeTree } from './routeTree.gen.ts'

const getSsrOptions = createIsomorphicFn().server(() => {
  if (isPrerendering()) {
    return undefined
  }
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return { nonce: Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('') }
})

export function getRouter() {
  const queryClient = createQueryClient(
    { defaultOptions: { queries: { staleTime: 30_000 } } },
    { onClear: () => router.clearCache() },
  )
  const router = createRouter({
    routeTree,
    context: { queryClient },
    defaultPreload: 'intent',
    defaultErrorComponent: RouteError,
    defaultPendingComponent: RoutePending,
    defaultNotFoundComponent: RouteNotFound,
    scrollRestoration: true,
    ssr: getSsrOptions(),
  })
  setupRouterSsrQueryIntegration({ queryClient, router })
  return router
}
