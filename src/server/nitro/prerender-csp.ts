import { createHash } from 'node:crypto'
import { defaultTreeAdapter, parse } from 'parse5'
import type { DefaultTreeAdapterTypes } from 'parse5'

type ParentNode = DefaultTreeAdapterTypes.ParentNode
type Element = DefaultTreeAdapterTypes.Element

const sha256 = (text: string) => `'sha256-${createHash('sha256').update(text, 'utf8').digest('base64')}'`

const isElement = (node: DefaultTreeAdapterTypes.Node): node is Element => 'tagName' in node

const textOf = (element: Element) =>
  element.childNodes.map((child) => (defaultTreeAdapter.isTextNode(child) ? child.value : '')).join('')

function* elementsOf(parent: ParentNode): Generator<Element> {
  for (const node of parent.childNodes) {
    if (!isElement(node)) {
      continue
    }
    yield node
    yield* elementsOf(node)
    if (node.tagName === 'template') {
      // parse5 attaches a document fragment to template nodes in its default tree adapter.
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion
      yield* elementsOf((node as DefaultTreeAdapterTypes.Template).content)
    }
  }
}

const rejectInlineAttributes = (element: Element) => {
  const inline = element.attrs.find(({ name }) => name === 'style' || name.startsWith('on'))
  if (inline) {
    throw new Error(
      `prerendered HTML has an inline \`${inline.name}\` attribute on <${element.tagName}>; CSP forbids it`,
    )
  }
}

interface InlineSourceHashes {
  script: Array<string>
  style: Array<string>
}

export const inlineSourceHashes = (html: string): InlineSourceHashes => {
  const script = new Set<string>()
  const style = new Set<string>()
  for (const element of elementsOf(parse(html))) {
    rejectInlineAttributes(element)
    if (element.tagName === 'script' && !element.attrs.some((attr) => attr.name === 'src')) {
      script.add(sha256(textOf(element)))
    }
    if (element.tagName === 'style') {
      style.add(sha256(textOf(element)))
    }
  }
  return { script: [...script], style: [...style] }
}
