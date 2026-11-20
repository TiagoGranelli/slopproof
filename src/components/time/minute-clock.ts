let now = Date.now()
const listeners = new Set<() => void>()

const refresh = () => {
  if (document.visibilityState === 'hidden') {
    return
  }
  now = Date.now()
  for (const listener of listeners) {
    listener()
  }
}

/** The browser's current time, refreshed on mount and when the tab regains focus: `useSyncExternalStore`'s snapshot. */
export const readMinuteClock = (): number => now

/**
 * For `useSyncExternalStore`: refreshes relative times ("5 minutes ago") when the first subscriber mounts and
 * whenever the tab becomes visible, regains focus or returns from bfcache, without background timers.
 */
export function subscribeToMinuteClock(listener: () => void): () => void {
  if (listeners.size === 0) {
    now = Date.now()
    document.addEventListener('visibilitychange', refresh)
    window.addEventListener('focus', refresh)
    window.addEventListener('pageshow', refresh)
  }
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) {
      document.removeEventListener('visibilitychange', refresh)
      window.removeEventListener('focus', refresh)
      window.removeEventListener('pageshow', refresh)
    }
  }
}
