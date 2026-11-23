import { useRouter } from '@tanstack/react-router'
import type { AnyRouter } from '@tanstack/react-router'
import { useSyncExternalStore } from 'react'
import { flashMessage } from '#/lib/flash.ts'

type Announcement = { readonly id: number; readonly text: string }

const QUIET: Announcement = { id: 0, text: '' }
const latest = new WeakMap<AnyRouter, Announcement>()

const focusNewPage = () => {
  const headings = document.querySelectorAll<HTMLElement>('main h1')
  const visibleHeading = Array.from(headings).find((heading) => heading.getClientRects().length > 0)
  const target = visibleHeading ?? document.querySelector<HTMLElement>('main')
  target?.focus({ preventScroll: true })
}

const landing = new WeakSet<AnyRouter>()

const subscribeToNavigations = (router: AnyRouter, onChange: () => void) => {
  const stopWatchingActions = router.subscribe('onBeforeNavigate', (event) => {
    if (flashMessage(event.toLocation.state.flash)) {
      landing.add(router)
    }
  })
  const stopAnnouncing = router.subscribe('onRendered', (event) => {
    const actionLanded = landing.has(router)
    landing.delete(router)
    if (!event.pathChanged && !actionLanded) {
      return
    }
    focusNewPage()
    const flash = document.querySelector('main [data-flash]')?.textContent
    const text = [document.title, flash].filter(Boolean).join('. ')
    const previous = latest.get(router) ?? QUIET
    latest.set(router, { id: previous.id + 1, text })
    onChange()
  })
  return () => {
    stopWatchingActions()
    stopAnnouncing()
  }
}

const noAnnouncementOnServer = () => QUIET

export function RouteAnnouncer() {
  const router = useRouter()
  const announcement = useSyncExternalStore(
    (onChange) => subscribeToNavigations(router, onChange),
    () => latest.get(router) ?? QUIET,
    noAnnouncementOnServer,
  )
  return (
    <div aria-atomic="true" aria-live="polite" className="sr-only">
      <span key={announcement.id}>{announcement.text}</span>
    </div>
  )
}
