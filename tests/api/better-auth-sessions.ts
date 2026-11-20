import { onTestFinished, vi } from 'vitest'
import { auth } from '#/server/auth.ts'

export const recordSessionLookups = (): (() => Array<string | null>) => {
  const getSession = vi.spyOn(auth.api, 'getSession').mockResolvedValue(null)
  onTestFinished(() => {
    getSession.mockRestore()
  })
  return () => getSession.mock.calls.map(([options]) => new Headers(options?.headers).get('cookie'))
}
