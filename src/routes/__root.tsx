import type { QueryClient } from '@tanstack/react-query'
import { HeadContent, Outlet, Scripts, createRootRouteWithContext } from '@tanstack/react-router'
import { RouteAnnouncer } from '#/components/layouts/route-announcer.tsx'
import { SiteFooter } from '#/components/layouts/site-footer.tsx'
import { SiteHeader } from '#/components/layouts/site-header.tsx'
import { SkipLink } from '#/components/layouts/skip-link.tsx'
import { APP_NAME, pageTitle } from '#/config/app.ts'
import { loadSession, useSessionUser } from '#/features/auth/api/get-session.ts'
import { SignOutButton } from '#/features/auth/components/sign-out-button.tsx'
import { documentHeaders, nonceSources } from '#/lib/content-security-policy.ts'
import { THEME_SCRIPT } from '#/lib/theme.ts'
import '#/styles/app.css'

const NOT_FOUND_TITLE = pageTitle('Page not found')

const isNotFound = (matches: ReadonlyArray<{ _notFound?: boolean; status: string }>) =>
  // The leading underscore is TanStack's name for the field, not ours to change.
  // oxlint-disable-next-line eslint/no-underscore-dangle
  matches.some((match) => match.status === 'notFound' || match._notFound === true)

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  loader: ({ context }) => loadSession(context.queryClient),
  shouldReload: true,
  headers: ({ ssr }) => (import.meta.env.PROD && ssr?.nonce ? documentHeaders(nonceSources(ssr.nonce)) : undefined),
  head: ({ matches }) => ({
    meta: [
      // HTML requires the label `utf-8` in <meta charset>; `utf8` is only an alias browsers tolerate.
      // oxlint-disable-next-line unicorn/text-encoding-identifier-case
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: isNotFound(matches) ? NOT_FOUND_TITLE : APP_NAME },
      { name: 'description', content: 'Short posts with public reading and authenticated authoring.' },
      { name: 'theme-color', media: '(prefers-color-scheme: light)', content: '#ffffff' },
      { name: 'theme-color', media: '(prefers-color-scheme: dark)', content: '#0a0a0a' },
    ],
    links: [{ rel: 'icon', href: '/favicon.svg', type: 'image/svg+xml' }],
    scripts: [{ children: THEME_SCRIPT }],
  }),
  component: RootDocument,
})

function RootDocument() {
  const user = useSessionUser()
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body className="flex min-h-dvh flex-col bg-background text-foreground antialiased">
        <SkipLink />
        <SiteHeader signOut={<SignOutButton />} user={user} />
        <main className="flex-1 outline-none" id="main" tabIndex={-1}>
          <Outlet />
          <RouteAnnouncer />
        </main>
        <SiteFooter />
        <Scripts />
      </body>
    </html>
  )
}
