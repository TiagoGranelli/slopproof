// Stands in for `react-style-singleton`'s `./singleton` module (via the `adoptedStylesheetSingleton` plugin in
// vite.config.ts). Radix Dialog / AlertDialog uses `react-remove-scroll-bar`, which calls `stylesheetSingleton()`
// to lock page scroll while a modal is open. Upstream injects a `<style>` element into `<head>`, which strict
// hash-based CSP (`style-src 'self'`, no nonce — e.g. a document loaded from prerendered `/about` and later
// navigated to `/dashboard`) blocks as a `style-src-elem:inline` violation (ADR 0010).
//
// Constructable Stylesheets (`CSSStyleSheet` + `document.adoptedStyleSheets`) apply the same rules through CSSOM
// instead of DOM `<style>` injection, so they work under `style-src 'self'` across Chromium, Firefox and Safari
// 16.4+ without weakening the CSP or requiring a per-request nonce.
import { getNonce } from 'get-nonce'

interface StylesheetHandle {
  readonly add: (css: string) => void
  readonly remove: () => void
}

type Detach = () => void

const supportsAdoptedStyleSheets = (): boolean =>
  typeof CSSStyleSheet === 'function' && 'adoptedStyleSheets' in document

const attachAdoptedSheet = (css: string): Detach => {
  const sheet = new CSSStyleSheet()
  sheet.replaceSync(css)
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet]
  return () => {
    document.adoptedStyleSheets = document.adoptedStyleSheets.filter((entry) => entry !== sheet)
  }
}

const attachStyleElement = (css: string): Detach => {
  const tag = document.createElement('style')
  const nonce = getNonce()
  if (nonce) {
    tag.setAttribute('nonce', nonce)
  }
  tag.append(document.createTextNode(css))
  document.head.append(tag)
  return () => {
    tag.remove()
  }
}

const attachSheet = (css: string): Detach | null => {
  if (typeof document === 'undefined') {
    return null
  }
  return supportsAdoptedStyleSheets() ? attachAdoptedSheet(css) : attachStyleElement(css)
}

/**
 * Reference-counted runtime stylesheet mounted via Constructable Stylesheets (`document.adoptedStyleSheets`),
 * falling back to a nonced `<style>` tag when Constructable Stylesheets are unavailable.
 */
export const stylesheetSingleton = (): StylesheetHandle => {
  let count = 0
  let detach: Detach | null = null
  return {
    add(css) {
      if (count === 0) {
        detach = attachSheet(css)
      }
      count += 1
    },
    remove() {
      count = Math.max(0, count - 1)
      if (count === 0) {
        detach?.()
        detach = null
      }
    },
  }
}
