import { Link } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { APP_NAME } from '#/config/app.ts'

const navLink =
  'rounded-sm text-muted-foreground hover:text-foreground data-[status=active]:text-foreground forced-colors:data-[status=active]:underline'

type HeaderUser = { readonly name: string } | null | undefined

function AccountLinks(props: { signOut: ReactNode; user: HeaderUser }) {
  const { user } = props
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
