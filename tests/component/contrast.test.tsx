import '#/styles/app.css'
import { afterEach, describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'
import { page, userEvent } from 'vitest/browser'
import { Button } from '#/components/ui/button.tsx'
import { Input } from '#/components/ui/input.tsx'
import { Textarea } from '#/components/ui/textarea.tsx'

type Rgb = readonly [number, number, number]

const painted = (color: string, under = 'white'): Rgb => {
  const canvas = Object.assign(document.createElement('canvas'), { height: 1, width: 1 })
  const context = canvas.getContext('2d', { willReadFrequently: true })!
  context.fillStyle = under
  context.fillRect(0, 0, 1, 1)
  context.fillStyle = color
  context.fillRect(0, 0, 1, 1)
  const [red = 0, green = 0, blue = 0] = context.getImageData(0, 0, 1, 1).data
  return [red, green, blue]
}

const luminance = (rgb: Rgb) => {
  const [red, green, blue] = rgb.map((byte) => {
    const channel = byte / 255
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  }) as [number, number, number]
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue
}

const contrast = (first: Rgb, second: Rgb) => {
  const [lighter, darker] = [luminance(first), luminance(second)].toSorted((a, b) => b - a) as [number, number]
  return (lighter + 0.05) / (darker + 0.05)
}

const surfaceOf = (element: Element): Rgb => {
  for (let node: Element | null = element; node; node = node.parentElement) {
    const background = getComputedStyle(node).backgroundColor
    if (painted(background, 'red').join() === painted(background, 'blue').join()) {
      return painted(background)
    }
  }
  return painted('white')
}

const Controls = () => (
  <div className="grid gap-4 bg-background p-8">
    <Input aria-label="Name" />
    <Textarea aria-label="Post" />
    <Button>Publish</Button>
    <Button variant="outline">Cancel</Button>
    <div className="bg-card p-4" data-testid="card">
      <Button variant="ghost">Edit</Button>
    </div>
  </div>
)

const themes = ['light', 'dark'] as const

afterEach(() => {
  delete document.documentElement.dataset.theme
})

describe.each(themes)('%s theme', (theme) => {
  const renderControls = async () => {
    document.documentElement.dataset.theme = theme
    await render(<Controls />)
  }

  it.each(['Name', 'Post'])('the %s field border has 3:1 against the page and against its own fill', async (name) => {
    await renderControls()
    const field = page.getByRole('textbox', { name }).element()
    const pageColor = surfaceOf(field.parentElement!)
    const border = painted(getComputedStyle(field).borderTopColor, `rgb(${pageColor.join()})`)
    const fill = painted(getComputedStyle(field).backgroundColor, `rgb(${pageColor.join()})`)
    expect(contrast(border, pageColor), `${theme} ${name} border vs page`).toBeGreaterThanOrEqual(3)
    expect(contrast(border, fill), `${theme} ${name} border vs its fill`).toBeGreaterThanOrEqual(3)
  })

  it('shows keyboard focus as a solid 2px outline, clear of the control, with 3:1 against what it sits on', async () => {
    await renderControls()
    const stops = ['Name', 'Post', 'Publish', 'Cancel', 'Edit']
    for (const name of stops) {
      await userEvent.tab()
      const focused = document.activeElement!
      expect(focused.getAttribute('aria-label') ?? focused.textContent).toBe(name)
      await Promise.all(focused.getAnimations().map((animation) => animation.finished))
      const style = getComputedStyle(focused)
      expect([style.outlineStyle, style.outlineWidth, style.outlineOffset], name).toEqual(['solid', '2px', '2px'])
      const surface = surfaceOf(focused.parentElement!)
      const outline = painted(style.outlineColor, `rgb(${surface.join()})`)
      expect(contrast(outline, surface), `${theme} focus outline of ${name}`).toBeGreaterThanOrEqual(3)
    }
  })
})
