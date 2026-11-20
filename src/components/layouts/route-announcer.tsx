import { type AnyRouter, useRouter } from '@tanstack/react-router'
import { useSyncExternalStore } from 'react'
import { flashMessage } from '#/lib/flash.ts'

type Announcement = { readonly id: number; readonly text: string }

const QUIET: Announcement = { id: 0, text: '' }
const latest = new WeakMap<AnyRouter, Announcement>()

/** Where focus goes on a new page: its heading, or the main region of a page without one. */
const focusNewPage = () => {
  const target = document.querySelector<HTMLElement>('main h1') ?? document.querySelector<HTMLElement>('main')
  // Scroll restoration has already placed the page; focusing must not scroll it again.
  target?.focus({ preventScroll: true })
}

// Routers whose current navigation carries a flash: an action that lands on the page it started from (Sign out on
// /) changes no path, and its button may be gone, so the page counts as new. Read when the navigation starts,
// because FlashMessage then drops the flash with a navigation that replaces this one.
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
    // The flash message on screen (FlashMessage), read from the page: by now it may be gone from the location.
    const flash = document.querySelector('main [data-flash]')?.textContent
    const text = [document.title, flash].filter(Boolean).join('. ')
    const previous = latest.get(router) ?? QUIET
    // `id` changes on every navigation: two pages with the same title are still two announcements.
    latest.set(router, { id: previous.id + 1, text })
    onChange()
  })
  return () => {
    stopWatchingActions()
    stopAnnouncing()
  }
}

const noAnnouncementOnServer = () => QUIET

/**
 * Does for a client-side navigation what a full page load does for assistive technology: focus moves to the new
 * page's heading instead of staying on a link that may be gone, and screen readers hear the new page's title (and
 * its flash message, if an action left one), politely. TanStack Router 1.170 has neither built in, only scroll
 * restoration. A change of search or hash on the same page (the skip link) is left alone. Mounted once, inside
 * `<main>`, so the live region exists before it changes.
 */
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
