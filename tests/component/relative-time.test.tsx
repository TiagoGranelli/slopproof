import { describe, expect, it, vi } from 'vitest'
import { RelativeTime } from '#/components/time/relative-time.tsx'
import { renderInApp, serverRendered } from './test-utils.tsx'

const fiveMinutesAgo = () => new Date(Date.now() - 5 * 60_000 - 5000).toISOString()

describe('RelativeTime', () => {
  it('renders the UTC date on the server, hydrates without a mismatch, then reads relative', async () => {
    const iso = fiveMinutesAgo()
    const rendered = await serverRendered(<RelativeTime iso={iso} />)
    const time = () => rendered.container.querySelector('time')!
    const utcDate = new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(iso))
    expect(time().textContent).toBe(utcDate)
    expect(time().title).toMatch(/ UTC$/)
    rendered.hydrate()
    await expect.poll(() => time().textContent).toBe('5 minutes ago')
    expect(rendered.mismatches).toEqual([])
    expect(time().dateTime).toBe(iso)
    expect(time().title).not.toMatch(/UTC/)
  })

  it('reads relative at once when rendered in the browser (a client-side navigation)', async () => {
    const iso = fiveMinutesAgo()
    const { container } = await renderInApp(<RelativeTime iso={iso} />)
    const time = container.querySelector('time')!
    expect(time.textContent).toBe('5 minutes ago')
    expect(time.getAttribute('datetime')).toBe(iso)
  })

  it('refreshes relative text when the window regains focus', async () => {
    const start = Date.parse('2026-09-27T12:05:00.000Z')
    const now = vi.spyOn(Date, 'now').mockReturnValue(start)
    try {
      const { container } = await renderInApp(<RelativeTime iso="2026-09-27T12:00:00.000Z" />)
      const time = container.querySelector('time')!
      expect(time.textContent).toBe('5 minutes ago')
      now.mockReturnValue(start + 2 * 60_000)
      window.dispatchEvent(new Event('focus'))
      await expect.poll(() => time.textContent).toBe('7 minutes ago')
    } finally {
      now.mockRestore()
    }
  })
})
