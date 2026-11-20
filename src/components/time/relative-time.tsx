import { useSyncExternalStore } from 'react'
import { describeTime } from '#/components/time/describe-time.ts'
import { readMinuteClock, subscribeToMinuteClock } from '#/components/time/minute-clock.ts'

const noClockOnServer = () => null

export function RelativeTime(props: { iso: string }) {
  const now = useSyncExternalStore(subscribeToMinuteClock, readMinuteClock, noClockOnServer)
  const { label, title } = describeTime(props.iso, now === null ? null : { now })
  return (
    <time dateTime={props.iso} title={title}>
      {label}
    </time>
  )
}
