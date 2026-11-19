import { Link } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { APP_NAME } from '#/config/app.ts'

// The current page's link is `aria-current="page"` (TanStack marks it `data-status="active"`) and shows it in its
// color; forced colors (Windows High Contrast) drop that color, so there it is underlined instead.
const navLink =
  'rounded-sm text-muted-foreground hover:text-foreground data-[status=active]:text-foreground forced-colors:data-[status=active]:underline'

/** Who is signed in, as the header shows it: `null` signed out, `undefined` not known (a prerendered page). */
type HeaderUser = { readonly name: string } | null | undefined

function AccountLinks(props: { signOut: ReactNode; user: HeaderUser }) {
  const { user } = props
  // A page prerendered at build time cannot know; Dashboard is right either way (its guard sends to sign-in).
  if (user === undefined) {
    return (
      <Link className={navLink} to="/dashboard">
        Dashboard
      </Link>
    )
  }
  if (user === null) {
    return (
      <Link className={navLink} to="/login">
        Sign in
      </Link>
    )
  }
  return (
    <>
      <span className="max-w-48 truncate border-r pr-5 font-medium">{user.name}</span>
      <Link className={navLink} to="/dashboard">
        Dashboard
      </Link>
      <Link className={navLink} to="/account">
        Account
      </Link>
      {props.signOut}
    </>
  )
}

/**
 * The header on every page: the main navigation, then the account's links for `user` (see HeaderUser) and its
 * `signOut` control, which the app composes from the auth feature.
 */
export function SiteHeader(props: { signOut: ReactNode; user: HeaderUser }) {
  return (
    <header className="border-b">
      <nav
        aria-label="Main"
        className="mx-auto flex max-w-2xl flex-wrap items-center gap-x-5 gap-y-2 px-4 py-3 text-sm"
      >
        <Link className="mr-1 rounded-sm font-semibold tracking-tight" to="/">
          {APP_NAME}
        </Link>
        <Link className={navLink} to="/about">
          About
        </Link>
        <div className="ml-auto flex flex-wrap items-center justify-end gap-x-5 gap-y-2">
          <AccountLinks signOut={props.signOut} user={props.user} />
        </div>
      </nav>
    </header>
  )
}
