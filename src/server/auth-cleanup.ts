import '@tanstack/react-start/server-only'
import { lt } from 'drizzle-orm'
import { runInBackground } from './background-tasks.ts'
import { db } from './db/client.ts'
import { session, verification } from './db/schema/auth.ts'
import { onShutdown } from './lifecycle.ts'
import { log } from './log.ts'

export const EXPIRED_SESSION_RETENTION_MS = 7 * 24 * 60 * 60 * 1000
const INTERVAL_MS = 10 * 60 * 1000

export const deleteExpiredAuthRows = async (now = Date.now()): Promise<{ sessions: number; verifications: number }> => {
  const sessions = await db.delete(session).where(lt(session.expiresAt, new Date(now - EXPIRED_SESSION_RETENTION_MS)))
  const verifications = await db.delete(verification).where(lt(verification.expiresAt, new Date(now)))
  return { sessions: sessions.rowCount ?? 0, verifications: verifications.rowCount ?? 0 }
}

let timer: NodeJS.Timeout | undefined

const cleanUp = async () => {
  const deleted = await deleteExpiredAuthRows()
  if (deleted.sessions || deleted.verifications) {
    log('info', 'expired auth rows deleted', deleted)
  }
}

export const scheduleAuthCleanup = (): void => {
  if (timer) {
    return
  }
  // Effect Clock.sleep lacks .unref(), which would keep CLI scripts alive when auth.ts loads.
  // oxlint-disable-next-line no-restricted-globals
  timer = setInterval(() => runInBackground(cleanUp()), INTERVAL_MS).unref()
  onShutdown('auth-cleanup', () => {
    clearInterval(timer)
    timer = undefined
  })
}
