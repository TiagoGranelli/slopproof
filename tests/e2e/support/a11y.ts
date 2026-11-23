import { AxeBuilder } from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { APP_NAME } from '#/config/app.ts'

const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice']

export async function expectAccessible(page: Page, state: string) {
  await page.evaluate(async () => {
    for (;;) {
      const running = document
        .getAnimations()
        .filter((a) => a.playState === 'running' && Number.isFinite(Number(a.effect?.getComputedTiming().endTime)))
      if (running.length === 0) {
        return
      }
      await Promise.allSettled(running.map((a) => a.finished))
    }
  })
  const scan = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze()
  await test.info().attach(`axe ${state}.json`, {
    body: JSON.stringify(scan.violations, null, 2),
    contentType: 'application/json',
  })
  const violations = scan.violations.map(
    (v) => `${v.id} (${v.impact}): ${v.help} at ${v.nodes.map((node) => node.target.join(' ')).join(', ')}`,
  )
  expect(violations, `axe violations in "${state}"`).toEqual([])
}

export type TabStop = {
  name: string
  visibleFocus: boolean
}

export async function tabThrough(
  page: Page,
  options: { backwards?: boolean; max?: number } = {},
): Promise<Array<TabStop>> {
  const { backwards = false, max = 300 } = options
  await page.evaluate((atStart) => {
    const sentinel = Object.assign(document.createElement('span'), { id: 'tab-walk-end', tabIndex: 0 })
    if (atStart) {
      document.body.prepend(sentinel)
    } else {
      document.body.append(sentinel)
    }
  }, backwards)
  try {
    return await walkToSentinel(page, { backwards, max })
  } finally {
    await page.evaluate(() => {
      document.getElementById('tab-walk-end')?.remove()
      delete (globalThis as WalkState).tabWalkSeen
    })
  }
}

type WalkState = { tabWalkSeen?: WeakSet<Element> }

const walkToSentinel = async (page: Page, { backwards, max }: { backwards: boolean; max: number }) => {
  const stops: Array<TabStop> = []
  const walked = () => stops.map((stop) => stop.name).join(' → ')
  for (let i = 0; i < max; i++) {
    await page.keyboard.press(backwards ? 'Shift+Tab' : 'Tab')
    const stop = await focusedStop(page)
    if (stop === 'lost') {
      throw new Error(`focus was lost to the document after ${walked() || 'no stops'}`)
    }
    if (stop === 'sentinel') {
      return stops
    }
    if (stop.again) {
      throw new Error(`focus is trapped: it came back to ${stop.name} after ${walked()}`)
    }
    stops.push(stop)
  }
  throw new Error(`focus did not get past the page after ${max} key presses: ${walked()}`)
}

const focusedStop = async (page: Page): Promise<(TabStop & { again: boolean }) | 'sentinel' | 'lost'> => {
  const focused = page.locator(':focus')
  if ((await focused.count()) === 0) {
    return 'lost'
  }
  const visit = await focused.evaluate((element) => {
    if (element.id === 'tab-walk-end') {
      return 'sentinel'
    }
    const seen = ((globalThis as WalkState).tabWalkSeen ??= new WeakSet())
    const again = seen.has(element)
    seen.add(element)
    return again ? 'again' : 'first'
  })
  if (visit === 'sentinel') {
    return 'sentinel'
  }
  const snapshot = await focused.ariaSnapshot()
  const [, role, label] = /^- '?([\w-]+)(?: "((?:[^"\\]|\\.)*)")?/.exec(snapshot) ?? []
  const visibleFocus = await focused.evaluate((element) => {
    const style = getComputedStyle(element)
    const outline = style.outlineStyle !== 'none' && Number.parseFloat(style.outlineWidth) > 0
    return element.matches(':focus-visible') && (outline || style.boxShadow !== 'none')
  })
  return { again: visit === 'again', name: label === undefined ? `${role}` : `${role} "${label}"`, visibleFocus }
}

export async function tabOrder(page: Page, max?: number) {
  await page.evaluate(() => {
    const start = Object.assign(document.createElement('span'), { id: 'tab-order-start', tabIndex: -1 })
    document.body.prepend(start)
    start.focus()
  })
  try {
    return await tabThrough(page, { max })
  } finally {
    await page.evaluate(() => document.getElementById('tab-order-start')?.remove())
  }
}

export function expectTabStops(
  stops: Array<TabStop>,
  expected: { first: Array<string>; inOrder: Array<string>; last: Array<string>; never?: Array<string> },
) {
  const names = stops.map((stop) => stop.name)
  const walk = `the walk ${names.join(' → ')}`
  expect(names.slice(0, expected.first.length), `the start of ${walk}`).toEqual(expected.first)
  expect(names.slice(names.length - expected.last.length), `the end of ${walk}`).toEqual(expected.last)
  const between = names.slice(expected.first.length, names.length - expected.last.length)
  expect(inOrderWithin(between, expected.inOrder), `controls in order in ${walk}`).toEqual(expected.inOrder)
  expect(
    between.filter((name) => expected.never?.includes(name)),
    `controls that must not be Tab stops`,
  ).toEqual([])
  expect(
    stops.flatMap((stop) => (stop.visibleFocus ? [] : [stop.name])),
    'stops without visible focus',
  ).toEqual([])
}

const inOrderWithin = (names: Array<string>, wanted: Array<string>) => {
  let found = 0
  for (const name of names) {
    if (name === wanted[found]) {
      found++
    }
  }
  return wanted.slice(0, found)
}

const ACCOUNT_LINKS = {
  'signed in': `
    - text: /\\S/
    - link "Dashboard"
    - link "Account"
    - button "Sign out"`,
  'signed out': `
    - link "Sign in"`,
}

export const siteHeader = (session: keyof typeof ACCOUNT_LINKS) => `
- link "Skip to content"
- banner:
  - navigation "Main":
    - link "${APP_NAME}"
    - link "About"${ACCOUNT_LINKS[session]}`

export const SITE_FOOTER = `
- contentinfo:
  - paragraph
  - group "Theme":
    - radio "System"
    - radio "Light"
    - radio "Dark"`
