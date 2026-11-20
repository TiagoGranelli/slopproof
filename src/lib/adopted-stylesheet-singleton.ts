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
