// Reference-counted Constructable Stylesheet singleton (and its <style> fallback) used in place of
// react-style-singleton's DOM <style> injector so Radix scroll-lock styles work under strict hash-based CSP.
import { setNonce } from 'get-nonce'
import { afterEach, describe, expect, it } from 'vitest'
import { stylesheetSingleton } from '#/lib/adopted-stylesheet-singleton.ts'

class FakeStyleSheet {
  cssText = ''

  replaceSync(css: string) {
    this.cssText = css
  }
}

interface FakeStyleElement {
  append: (node: { text: string }) => void
  attributes: Record<string, string>
  remove: () => void
  removed: boolean
  setAttribute: (name: string, value: string) => void
  text: string
}

const fakeStyleElement = (): FakeStyleElement => {
  const element: FakeStyleElement = {
    append(node) {
      element.text += node.text
    },
    attributes: {},
    remove() {
      element.removed = true
    },
    removed: false,
    setAttribute(name, value) {
      element.attributes[name] = value
    },
    text: '',
  }
  return element
}

const installAdoptedDocument = () => {
  const existing = new FakeStyleSheet()
  const fakeDocument = { adoptedStyleSheets: [existing] as Array<FakeStyleSheet> }
  Object.defineProperty(globalThis, 'CSSStyleSheet', { configurable: true, value: FakeStyleSheet })
  Object.defineProperty(globalThis, 'document', { configurable: true, value: fakeDocument })
  return { existing, fakeDocument }
}

const installFallbackDocument = () => {
  const appended: Array<FakeStyleElement> = []
  const fakeDocument = {
    createElement: () => fakeStyleElement(),
    createTextNode: (text: string) => ({ text }),
    head: {
      append(node: FakeStyleElement) {
        appended.push(node)
      },
    },
  }
  Reflect.deleteProperty(globalThis, 'CSSStyleSheet')
  Object.defineProperty(globalThis, 'document', { configurable: true, value: fakeDocument })
  return appended
}

const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document')
const originalCssStyleSheet = Object.getOwnPropertyDescriptor(globalThis, 'CSSStyleSheet')

const restoreGlobals = () => {
  if (originalDocument) {
    Object.defineProperty(globalThis, 'document', originalDocument)
  } else {
    Reflect.deleteProperty(globalThis, 'document')
  }
  if (originalCssStyleSheet) {
    Object.defineProperty(globalThis, 'CSSStyleSheet', originalCssStyleSheet)
  } else {
    Reflect.deleteProperty(globalThis, 'CSSStyleSheet')
  }
}

describe('stylesheetSingleton', () => {
  afterEach(() => {
    setNonce('')
    restoreGlobals()
  })

  it('mounts once via document.adoptedStyleSheets, ref-counts nested adds, and detaches on last remove', () => {
    const { existing, fakeDocument } = installAdoptedDocument()
    const singleton = stylesheetSingleton()

    // Extra remove before any add is a safe no-op.
    singleton.remove()
    expect(fakeDocument.adoptedStyleSheets).toEqual([existing])

    singleton.add('body[data-scroll-locked] { overflow: hidden !important; }')
    expect(fakeDocument.adoptedStyleSheets).toHaveLength(2)
    expect(fakeDocument.adoptedStyleSheets[1]?.cssText).toContain('overflow: hidden !important;')

    // Second add only increments the reference count and does not append a duplicate sheet.
    singleton.add('body { color: red; }')
    expect(fakeDocument.adoptedStyleSheets).toHaveLength(2)

    singleton.remove()
    expect(fakeDocument.adoptedStyleSheets).toHaveLength(2)

    singleton.remove()
    expect(fakeDocument.adoptedStyleSheets).toEqual([existing])
  })

  it('falls back to a nonced <style> tag when Constructable Stylesheets are unavailable', () => {
    const appended = installFallbackDocument()
    setNonce('abc123')
    const singleton = stylesheetSingleton()
    singleton.add('body { overflow: hidden; }')
    expect(appended).toHaveLength(1)
    expect(appended[0]?.attributes).toEqual({ nonce: 'abc123' })
    expect(appended[0]?.text).toBe('body { overflow: hidden; }')
    singleton.remove()
    expect(appended[0]?.removed).toBe(true)
  })

  it('omits the nonce attribute on the <style> fallback when no nonce is configured', () => {
    const appended = installFallbackDocument()
    const singleton = stylesheetSingleton()
    singleton.add('body { margin: 0; }')
    expect(appended).toHaveLength(1)
    expect(appended[0]?.attributes).toEqual({})
    singleton.remove()
    expect(appended[0]?.removed).toBe(true)
  })

  it('is a no-op during SSR when document is undefined', () => {
    Reflect.deleteProperty(globalThis, 'document')
    const singleton = stylesheetSingleton()
    expect(() => {
      singleton.add('body { overflow: hidden; }')
      singleton.remove()
    }).not.toThrow()
  })
})
