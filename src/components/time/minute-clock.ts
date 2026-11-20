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

export const readMinuteClock = (): number => now

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
