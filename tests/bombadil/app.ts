// Bombadil browser property specification for the running app (ADR 0018).
// Explores rendered pages with visible hit-tested interactive clicks plus Bombadil's default input/navigation
// generators while continuously verifying runtime, landmark, focus, HTTP 5xx, and CSP invariants.
import { always, type Formula } from '@antithesishq/bombadil'
import { type Action, actions, extract, type Fingerprint, getFingerprint } from '@antithesishq/bombadil/browser'
import { back, forward, inputs, reload, scroll, waitOnce } from '@antithesishq/bombadil/browser/defaults/actions'
import {
  noConsoleErrors,
  noUncaughtExceptions,
  noUnhandledPromiseRejections,
} from '@antithesishq/bombadil/browser/defaults/properties'

export {
  back,
  forward,
  inputs,
  noConsoleErrors,
  noUncaughtExceptions,
  noUnhandledPromiseRejections,
  reload,
  scroll,
  waitOnce,
}

const CSP_LISTENER_KEY = '__bombadilCspListenerInstalled'
const CSP_VIOLATIONS_KEY = '__bombadilCspViolations'
const INTERACTIVE_SELECTOR = 'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled])'

type CspTrackedWindow = Window & {
  [CSP_LISTENER_KEY]?: boolean
  [CSP_VIOLATIONS_KEY]?: Array<string>
}

type ClickTarget = {
  fingerprint: Fingerprint
  point: { x: number; y: number }
}

const isInteractiveAction = (action: Action | null): boolean =>
  typeof action === 'object' &&
  action !== null &&
  ('Click' in action || 'DoubleClick' in action || 'PressKey' in action || 'TypeText' in action)

const hitPoint = (element: Element, doc: Document, win: Window): { readonly x: number; readonly y: number } | null => {
  const rect = element.getBoundingClientRect()
  if (rect.width < 4 || rect.height < 4) {
    return null
  }
  const x = rect.left + rect.width / 2
  const y = rect.top + rect.height / 2
  if (x <= 0 || y <= 0 || x >= win.innerWidth || y >= win.innerHeight) {
    return null
  }
  const hit = doc.elementFromPoint(x, y)
  return hit && (element.contains(hit) || hit.contains(element)) ? { x, y } : null
}

const visibleTargets = extract((state) => {
  const modal = state.document.querySelector('[role="alertdialog"], [role="dialog"]')
  const root: ParentNode = modal ?? state.document
  const targets: Array<ClickTarget> = []
  for (const element of root.querySelectorAll(INTERACTIVE_SELECTOR)) {
    const point = hitPoint(element, state.document, state.window)
    if (point) {
      targets.push({ fingerprint: getFingerprint(element), point })
    }
  }
  return targets
})

/** Clicks only visible, non-occluded interactive controls (scoped to any open modal dialog). */
export const interactiveClicks = actions(() => visibleTargets.current.map((target) => ({ Click: target })))

const pageSnapshot = extract((state) => {
  const active = state.document.activeElement
  const tag = active ? active.tagName.toLowerCase() : 'none'
  return {
    activeIsBody: active === state.document.body,
    activeTag: tag,
    h1Count: state.document.querySelectorAll('h1').length,
    interactive: isInteractiveAction(state.lastAction),
    mainCount: state.document.querySelectorAll('main').length,
    pathname: state.window.location.pathname,
    readyState: state.document.readyState,
  }
})

/** Every loaded page renders exactly one h1 heading and one main landmark. */
export const singleH1AndMainLandmark: Formula = always(
  () =>
    pageSnapshot.current.readyState !== 'complete' ||
    (pageSnapshot.current.h1Count === 1 && pageSnapshot.current.mainCount === 1),
)

const previousPathname = extract((state) => {
  const key = '__bombadilPrevPathname'
  const tracked = state.window as Window & { [key]?: string }
  const previous = tracked[key] ?? null
  tracked[key] = state.window.location.pathname
  return previous
})

/**
 * Interactive actions on a page must never drop keyboard focus onto document.body.
 * Route changes and initial/reload states may reset focus to body before the next interaction.
 */
export const focusNeverDroppedToBodyAfterAction: Formula = always(() => {
  const current = pageSnapshot.current
  if (current.readyState !== 'complete' || !current.interactive) {
    return true
  }
  const navigated = previousPathname.current !== null && previousPathname.current !== current.pathname
  return navigated || !current.activeIsBody
})

const collect5xx = (entries: PerformanceEntryList): Array<number> =>
  entries.flatMap((entry) =>
    'responseStatus' in entry && typeof entry.responseStatus === 'number' && entry.responseStatus >= 500
      ? [entry.responseStatus]
      : [],
  )

const serverErrorStatuses = extract((state) => [
  ...collect5xx(state.window.performance.getEntriesByType('navigation')),
  ...collect5xx(state.window.performance.getEntriesByType('resource')),
])

/** No navigation or subresource request may ever answer with an HTTP 5xx status. */
export const noServerErrorResponses: Formula = always(() => serverErrorStatuses.current.length === 0)

const cspViolations = extract((state) => {
  const win = state.window as CspTrackedWindow
  if (!win[CSP_LISTENER_KEY]) {
    win[CSP_LISTENER_KEY] = true
    win[CSP_VIOLATIONS_KEY] = []
    state.document.addEventListener('securitypolicyviolation', (event) => {
      win[CSP_VIOLATIONS_KEY]?.push(`${event.violatedDirective}:${event.blockedURI}`)
    })
  }
  const consoleCsp = state.console
    .flatMap((entry) => entry.args.filter((arg): arg is string => typeof arg === 'string'))
    .filter((text) => text.includes('Content Security Policy'))
  return [...(win[CSP_VIOLATIONS_KEY] ?? []), ...consoleCsp]
})

/** The Content-Security-Policy must never record a violation on any page or interaction. */
export const noCspViolations: Formula = always(() => cspViolations.current.length === 0)
