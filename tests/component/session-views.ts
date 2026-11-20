import type { ReactNode } from 'react'
import { sessionsQueryKey } from '#/features/auth/api/get-sessions.ts'
import type { AuthOutcome, SessionView } from '#/lib/auth.functions.ts'
import { authFunction } from './api-mocks.ts'
import { renderInApp, testQueryClient } from './test-utils.tsx'

const FIREFOX_LINUX = 'Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0'
const CHROME_WINDOWS =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'

const session = (overrides: Partial<SessionView>): SessionView => ({
  createdAt: '2026-09-01T10:00:00.000Z',
  current: false,
  id: crypto.randomUUID(),
  ipAddress: '198.51.100.7',
  lastActiveAt: '2026-09-20T12:30:00.000Z',
  userAgent: FIREFOX_LINUX,
  ...overrides,
})
export const thisBrowser = session({ current: true, lastActiveAt: '2026-09-27T09:00:00.000Z' })
export const phone = session({ ipAddress: null, userAgent: CHROME_WINDOWS })
export const otherName = 'Sign out Chrome on Windows, signed in 2026-09-01 10:00 UTC'

export const listed = (...sessions: Array<SessionView>) => ({ ok: true, value: sessions }) as const
export const listSessions = (...sessions: Array<SessionView>) =>
  authFunction<ReadonlyArray<SessionView>>('listSessions', listed(...sessions))

export const renderWithSessions = (ui: ReactNode, sessions: AuthOutcome<ReadonlyArray<SessionView>>) => {
  const queryClient = testQueryClient()
  queryClient.setQueryData(sessionsQueryKey, sessions)
  return renderInApp(ui, { queryClient, url: '/account' })
}
