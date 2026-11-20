import '@tanstack/react-start/server-only'
import { Context, type Effect } from 'effect'
import type { CurrentUser } from '#/contract/middleware.ts'

export class SessionLookup extends Context.Service<
  SessionLookup,
  { readonly userOf: (headers: Headers) => Effect.Effect<CurrentUser['Service'] | null> }
>()('app/SessionLookup') {}
