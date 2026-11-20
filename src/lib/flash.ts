export const FLASH_MESSAGES = {
  'account-deleted': 'Your account and everything in it are deleted.',
  'password-reset': 'Your password is changed, and every session was signed out. Sign in with the new password.',
  'signed-out': 'You are signed out.',
  'signed-out-everywhere': 'You are signed out on every device.',
} as const

type Flash = keyof typeof FLASH_MESSAGES

declare module '@tanstack/react-router' {
  interface HistoryState {
    flash?: Flash
  }
}

const isFlash = (value: unknown): value is Flash => typeof value === 'string' && Object.hasOwn(FLASH_MESSAGES, value)

export function flashMessage(flash: unknown): string | undefined {
  return isFlash(flash) ? FLASH_MESSAGES[flash] : undefined
}
