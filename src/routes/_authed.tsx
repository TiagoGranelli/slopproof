import { Outlet, createFileRoute, redirect } from '@tanstack/react-router'
import { fetchFreshSession } from '#/features/auth/api/get-session.ts'

export const Route = createFileRoute('/_authed')({
  beforeLoad: async ({ context, location }) => {
    const session = await fetchFreshSession(context.queryClient)
    if (!session) {
      throw redirect({ to: '/login', search: { redirect: location.href } })
    }
    return { user: session.user }
  },
  component: Outlet,
  headers: () => ({ 'cache-control': 'private, no-store' }),
})
