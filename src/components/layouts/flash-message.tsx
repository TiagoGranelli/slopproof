import { useLocation, useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import { flashMessage } from '#/lib/flash.ts'

export function FlashMessage() {
  const router = useRouter()
  const pathname = useLocation({ select: (location) => location.pathname })
  const [ownPath] = useState(pathname)
  const flash = useLocation({
    select: (location) => (location.pathname === ownPath ? location.state.flash : undefined),
  })
  const [message, setMessage] = useState(() => flashMessage(flash))
  const [seen, setSeen] = useState(flash)
  if (flash !== seen) {
    setSeen(flash)
    if (flash) {
      setMessage(flashMessage(flash))
    }
  }
  const dropFlash = (node: HTMLParagraphElement | null) => {
    if (!node || !flash) {
      return
    }
    const { flash: _shown, ...state } = router.history.location.state
    router.history.replace(router.history.location.href, state)
  }
  if (!message || pathname !== ownPath) {
    return null
  }
  return (
    <p className="rounded-lg border bg-muted/60 px-4 py-3 text-sm" data-flash data-testid="flash" ref={dropFlash}>
      {message}
    </p>
  )
}
