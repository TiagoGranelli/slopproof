import '@tanstack/react-start/server-only'
import { isIPv6 } from 'node:net'

export const IPV6_SUBNET = 64

const stripZoneId = (address: string): string => {
  const zone = address.indexOf('%')
  return zone === -1 ? address : address.slice(0, zone)
}

export const displayClientAddress = (recorded: string): string =>
  isIPv6(recorded) ? `${new URL(`http://[${stripZoneId(recorded)}]`).hostname.slice(1, -1)}/${IPV6_SUBNET}` : recorded
