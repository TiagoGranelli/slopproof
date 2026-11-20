const LOCALE = 'en'
const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
const WEEK = 7 * DAY

const RELATIVE_UNITS: ReadonlyArray<{ below: number; size: number; unit: Intl.RelativeTimeFormatUnit }> = [
  { below: HOUR, size: MINUTE, unit: 'minute' },
  { below: DAY, size: HOUR, unit: 'hour' },
  { below: WEEK, size: DAY, unit: 'day' },
]

export type Clock = { readonly now: number; readonly timeZone?: string }

const relative = (elapsed: number): string | undefined => {
  if (elapsed < MINUTE) {
    return 'just now'
  }
  const scale = RELATIVE_UNITS.find(({ below }) => elapsed < below)
  if (!scale) {
    return undefined
  }
  const format = new Intl.RelativeTimeFormat(LOCALE, { numeric: 'auto' })
  return format.format(-Math.floor(elapsed / scale.size), scale.unit)
}

export interface TimeDescription {
  label: string
  title: string
}

export function describeTime(iso: string, clock: Clock | null): TimeDescription {
  const time = new Date(iso)
  const timeZone = clock ? clock.timeZone : 'UTC'
  const date = new Intl.DateTimeFormat(LOCALE, { dateStyle: 'medium', timeZone })
  const full = new Intl.DateTimeFormat(LOCALE, { dateStyle: 'full', timeStyle: 'short', timeZone })
  if (!clock) {
    return { label: date.format(time), title: `${full.format(time)} UTC` }
  }
  return { label: relative(clock.now - time.getTime()) ?? date.format(time), title: full.format(time) }
}
