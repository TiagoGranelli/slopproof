import '@tanstack/react-start/server-only'
import { isIP } from 'node:net'
import { Redacted } from 'effect'

const read = (name: string): string => {
  const value = process.env[name]?.trim()
  if (!value) {
    throw new Error(`Missing required environment variable ${name}. See .env.example.`)
  }
  return value
}

const readOrigin = (name: string): string => {
  const raw = read(name)
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error(`${name} must be an origin such as https://example.com (got "${raw}")`)
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error(`${name} must use http or https (got "${url.protocol}")`)
  }
  if (url.pathname !== '/' || url.search || url.hash) {
    throw new Error(
      `${name} must be an origin such as https://example.com, without a path, query or hash (got "${raw}")`,
    )
  }
  return url.origin
}

const readSecret = (name: string): Redacted.Redacted => {
  const value = read(name)
  if (value.length < 32) {
    throw new Error(
      `${name} must have at least 32 characters (got ${value.length}; generate one with: openssl rand -base64 32)`,
    )
  }
  return Redacted.make(value, { label: name })
}

const readCidrList = (name: string): Array<string> => {
  const entries = (process.env[name] ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
  for (const entry of entries) {
    // A string separator always leaves at least one element, even when the input is empty.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    const [address, prefix, ...rest] = entry.split('/') as [string, ...Array<string>]
    const family = isIP(address)
    const bits = family === 4 ? 32 : 128
    const validPrefix = prefix === undefined || (/^\d+$/.test(prefix) && Number(prefix) <= bits)
    if (family === 0 || !validPrefix || rest.length > 0) {
      throw new Error(`${name} must list IP addresses or CIDR ranges such as 10.0.0.0/8 (got "${entry}")`)
    }
  }
  return entries
}

const readInt = (name: string, bounds: { fallback: number; max: number; min: number }): number => {
  const { fallback, max, min } = bounds
  const raw = process.env[name]?.trim()
  if (!raw) {
    return fallback
  }
  const value = Number(raw)
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max} (got "${raw}")`)
  }
  return value
}

const schemeOf = (value: string): string => /^([a-z][a-z\d+.-]*):/i.exec(value)?.[1] ?? 'none'

const readDatabaseUrl = (name: string): Redacted.Redacted => {
  const value = read(name)
  if (!/^postgres(ql)?:\/\//.test(value)) {
    throw new Error(`${name} must be a postgres:// connection string (got scheme "${schemeOf(value)}")`)
  }
  return Redacted.make(value, { label: name })
}

const readChoice = <const T extends string>(name: string, choices: readonly [T, ...Array<T>]): T => {
  const value = process.env[name]?.trim() || choices[0]
  const choice = choices.find((candidate) => candidate === value)
  if (!choice) {
    throw new Error(`${name} must be one of ${choices.join(', ')} (got "${value}")`)
  }
  return choice
}

const checkSmtpUrl = (url: string): void => {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new Error('SMTP_URL must be a URL such as smtps://user:password@smtp.example.com:465')
  }
  if (!['smtp:', 'smtps:'].includes(parsed.protocol) || !parsed.hostname) {
    throw new Error(
      `SMTP_URL must use smtp:// (STARTTLS) or smtps:// (TLS) and name a host (got scheme "${schemeOf(url)}")`,
    )
  }
}

const readSmtp = (): { from: string; url: Redacted.Redacted } | undefined => {
  const url = process.env.SMTP_URL?.trim()
  if (!url) {
    return undefined
  }
  checkSmtpUrl(url)
  const from = read('MAIL_FROM')
  if (!/@[^@\s>]+>?$/.test(from)) {
    throw new Error(`MAIL_FROM must be an address such as "Acme <no-reply@example.com>" (got "${from}")`)
  }
  return { from, url: Redacted.make(url, { label: 'SMTP_URL' }) }
}

export const env = {
  appUrl: readOrigin('APP_URL'),
  authSecret: readSecret('BETTER_AUTH_SECRET'),
  authSignUp: readChoice('AUTH_SIGN_UP', ['closed', 'open']),
  databasePoolMax: readInt('DATABASE_POOL_MAX', { fallback: 10, max: 100, min: 1 }),
  databaseUrl: readDatabaseUrl('DATABASE_URL'),
  databaseUrlPooled: readChoice('DATABASE_URL_POOLED', ['false', 'true']) === 'true',
  isProduction: process.env.NODE_ENV === 'production',
  smtp: readSmtp(),
  trustedProxies: readCidrList('TRUSTED_PROXIES'),
}

if (env.authSignUp === 'open' && !env.smtp) {
  throw new Error('AUTH_SIGN_UP=open needs SMTP_URL and MAIL_FROM: new accounts must verify their email address')
}
