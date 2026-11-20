const BROWSERS: ReadonlyArray<[RegExp, string]> = [
  [/\bEdg(?:e|A|iOS)?\//, 'Edge'],
  [/\b(?:OPR|Opera)\//, 'Opera'],
  [/\b(?:Firefox|FxiOS)\//, 'Firefox'],
  [/\b(?:Chrome|CriOS|Chromium)\//, 'Chrome'],
  [/\bSafari\//, 'Safari'],
]
const SYSTEMS: ReadonlyArray<[RegExp, string]> = [
  [/\b(?:iPhone|iPad|iPod)\b/, 'iOS'],
  [/\bAndroid\b/, 'Android'],
  [/\bCrOS\b/, 'ChromeOS'],
  [/\bWindows\b/, 'Windows'],
  [/\bMac OS X\b|\bMacintosh\b/, 'macOS'],
  [/\bLinux\b/, 'Linux'],
]

const first = (list: ReadonlyArray<[RegExp, string]>, text: string) => list.find(([pattern]) => pattern.test(text))?.[1]

export function describeDevice(userAgent: string | null): string {
  if (!userAgent) {
    return 'Unknown device'
  }
  const browser = first(BROWSERS, userAgent)
  const system = first(SYSTEMS, userAgent)
  if (browser && system) {
    return `${browser} on ${system}`
  }
  return browser ?? system ?? 'Unknown device'
}

export function describeAddress(address: string): string {
  return address.includes('/') ? `IPv6 network ${address}` : address
}

export function formatTimestamp(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) {
    return iso
  }
  return `${date.toISOString().slice(0, 16).replace('T', ' ')} UTC`
}
