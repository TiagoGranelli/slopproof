import '@tanstack/react-start/server-only'
import { isIPv6 } from 'node:net'

export const IPV6_SUBNET = 64

export const displayClientAddress = (recorded: string): string =>
  isIPv6(recorded) ? `${new URL(`http://[${recorded}]`).hostname.slice(1, -1)}/${IPV6_SUBNET}` : recorded
