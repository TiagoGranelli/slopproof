import { describe, expect, it } from 'vitest'
import { displayClientAddress } from '#/server/http/client-address.ts'

describe('displayClientAddress', () => {
  it('keeps an IPv4 address whole', () => {
    expect(displayClientAddress('203.0.113.9')).toBe('203.0.113.9')
  })

  it('shows an IPv6 address as the /64 network Better Auth recorded', () => {
    expect(displayClientAddress('2001:0db8:0001:0002:0000:0000:0000:0000')).toBe('2001:db8:1:2::/64')
    expect(displayClientAddress('0000:0000:0000:0000:0000:0000:0000:0000')).toBe('::/64')
  })

  it('strips RFC 4007 IPv6 zone identifiers before normalizing', () => {
    expect(displayClientAddress('0:0:0:0:0:0:0:0%eth0')).toBe('::/64')
    expect(displayClientAddress('fe80::1%eth0')).toBe('fe80::1/64')
  })
})
