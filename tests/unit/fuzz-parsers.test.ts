import { isIPv6 } from 'node:net'
import { Exit, Schema } from 'effect'
import * as fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, POST_MAX_LENGTH, POSTS_PAGE_MAX } from '#/contract/limits.ts'
import { PageCursor, PageQuery } from '#/contract/pages.ts'
import { PostBody, PostInput } from '#/contract/post-input.ts'
import { isFreeOfNul } from '#/contract/stored-text.ts'
import {
  ChangePasswordInput,
  DeleteAccountFields,
  DeleteAccountInput,
  EmailInput,
  ResetPasswordInput,
  SessionInput,
  SignInFormPost,
  SignInInput,
  SignUpInput,
  TokenInput,
} from '#/lib/account-input.ts'
import { documentHeaders, nonceSources } from '#/lib/content-security-policy.ts'
import { displayClientAddress, IPV6_SUBNET } from '#/server/http/client-address.ts'
import { forwardedFor } from '#/server/http/forwarded-for.ts'

const TRICKY_TOKENS = [
  '',
  ' ',
  '\t\r\n',
  '\u0000',
  'before\u0000after',
  '\u202Eadmin\u202C',
  '\u2066rtl\u2069',
  '\u0007\u001B[31m',
  '\u00A0padded\u2003',
  '\uFEFFbom',
  'e\u0301',
  'é',
  '１２３',
  '😀'.repeat(5),
  'x'.repeat(POST_MAX_LENGTH + 1),
  'a'.repeat(2100),
]

const adversarialString = fc.oneof(
  fc.string({ maxLength: 64 }),
  fc.constantFrom(...TRICKY_TOKENS),
  fc.tuple(fc.string({ maxLength: 24 }), fc.constantFrom(...TRICKY_TOKENS)).map(([head, tail]) => `${head}${tail}`),
  fc.tuple(fc.constantFrom(...TRICKY_TOKENS), fc.string({ maxLength: 24 })).map(([head, tail]) => `${head}${tail}`),
)

const ipv4Mapped = fc.ipV4().map((ip) => `::ffff:${ip}`)

const cidrBoundary = fc.oneof(
  fc.tuple(fc.ipV4(), fc.constantFrom('0', '8', '24', '32', '33', '-1', 'abc')).map(([ip, mask]) => `${ip}/${mask}`),
  fc.tuple(fc.ipV6(), fc.constantFrom('0', '64', '128', '129', '-1', 'ff')).map(([ip, mask]) => `${ip}/${mask}`),
  fc.tuple(fc.ipV6(), fc.constantFrom('eth0', 'en0', '1')).map(([ip, zone]) => `${ip}%${zone}`),
  fc.ipV6().map((ip) => `[${ip}]`),
)

const addressCandidates = fc.oneof(fc.ipV4(), fc.ipV6(), ipv4Mapped, cidrBoundary, adversarialString)

const expectedForwarded = (received: string | null, peer: string | undefined, trustsProxies: boolean) => {
  if (!peer) {
    return undefined
  }
  const chain = trustsProxies ? received?.trim() : undefined
  return chain ? `${chain}, ${peer}` : peer
}

const forwardedChains = fc.option(
  fc.oneof(
    adversarialString,
    fc.array(addressCandidates, { maxLength: 6 }).map((hops) => hops.join(hops.length % 2 === 0 ? ', ' : ' , , ')),
  ),
)

const decodeCursor = Schema.decodeUnknownExit(PageCursor)
const encodeCursor = Schema.encodeSync(PageCursor)
const decodeQuery = Schema.decodeUnknownExit(Schema.Struct(PageQuery))
const decodePostInput = Schema.decodeUnknownExit(PostInput)
const decodeSignIn = Schema.decodeUnknownExit(SignInInput)
const decodeSignUp = Schema.decodeUnknownExit(SignUpInput)
const decodeEmail = Schema.decodeUnknownExit(EmailInput)
const decodeToken = Schema.decodeUnknownExit(TokenInput)
const decodeSession = Schema.decodeUnknownExit(SessionInput)
const decodeReset = Schema.decodeUnknownExit(ResetPasswordInput)
const decodeChange = Schema.decodeUnknownExit(ChangePasswordInput)
const decodeDelete = Schema.decodeUnknownExit(DeleteAccountInput)
const decodeDeleteFields = Schema.decodeUnknownExit(DeleteAccountFields)
const decodeSignInForm = Schema.decodeUnknownExit(SignInFormPost)
const NulFreeText = Schema.String.check(isFreeOfNul)

const toBase64Url = (raw: string) => Buffer.from(raw, 'utf8').toString('base64url')

const isValidUtcCursor = (cursor: PageCursor) => {
  const isoPattern = /^(?!0000)\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(cursor.createdAt)
  const date = new Date(`${cursor.createdAt.slice(0, 23)}Z`)
  const realDate = !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 23) === cursor.createdAt.slice(0, 23)
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(cursor.id)
  return isoPattern && realDate && uuid
}

const formOf = (entries: ReadonlyArray<readonly [string, string | Blob]>) => {
  const form = new FormData()
  for (const [key, value] of entries) {
    form.set(key, value)
  }
  return form
}

describe('fuzz forwardedFor and displayClientAddress', () => {
  it('enforces peer integrity and proxy trust invariants on adversarial chains', () => {
    const peerPool = fc.oneof(fc.constant(undefined), fc.constant(''), addressCandidates)
    fc.assert(
      fc.property(forwardedChains, peerPool, fc.boolean(), (received, peer, trustsProxies) => {
        expect(forwardedFor(received, peer, trustsProxies)).toBe(expectedForwarded(received, peer, trustsProxies))
      }),
      { numRuns: 250 },
    )
  })

  it('never throws and formats IPv6 as /64 while keeping non-IPv6 verbatim', () => {
    fc.assert(
      fc.property(addressCandidates, (recorded) => {
        const displayed = displayClientAddress(recorded)
        const expectedV6 = isIPv6(recorded)
        const validSuffix = displayed.endsWith(`/${IPV6_SUBNET}`) && isIPv6(displayed.slice(0, -3))
        expect(expectedV6 ? validSuffix : displayed === recorded).toBe(true)
      }),
      { numRuns: 250 },
    )
  })

  it('parses RFC 4007 zone-scoped IPv6 addresses without throwing', () => {
    const zoneIds = fc.constantFrom('eth0', 'en0', 'lo0', '1')
    expect(displayClientAddress('0:0:0:0:0:0:0:0%eth0')).toBe('::/64')
    expect(displayClientAddress('fe80::1%eth0')).toBe('fe80::1/64')
    fc.assert(
      fc.property(fc.ipV6(), zoneIds, (ip, zone) => {
        const displayed = displayClientAddress(`${ip}%${zone}`)
        expect(displayed).toBe(displayClientAddress(ip))
        expect(displayed.endsWith(`/${IPV6_SUBNET}`)).toBe(true)
      }),
      { numRuns: 150 },
    )
  })
})

describe('fuzz PageCursor and PageQuery', () => {
  it('rejects malformed base64url, JSON, BiDi, NUL and over-limit cursors without throwing', () => {
    const rawCursors = fc.oneof(
      adversarialString,
      adversarialString.map((raw) => toBase64Url(raw)),
      fc.string({ maxLength: 64 }).map((raw) => `${toBase64Url(raw)}=+=`),
      fc
        .record({ createdAt: adversarialString, id: fc.oneof(adversarialString, fc.uuid()) })
        .map((payload) => toBase64Url(JSON.stringify(payload))),
      fc.constantFrom(
        toBase64Url('{"__proto__":{"polluted":true}}'),
        toBase64Url('{"createdAt":"2026-01-01T00:00:00.000000Z","id":"00000000-0000-4000-8000-000000000000",}'),
        toBase64Url(`{"createdAt":"2026-01-01T00:00:00.000000Z\u0000","id":"00000000-0000-4000-8000-000000000000"}`),
      ),
    )
    fc.assert(
      fc.property(rawCursors, (raw) => {
        const exit = decodeCursor(raw)
        const accepted = Exit.isSuccess(exit) ? exit.value : undefined
        expect(accepted === undefined || isValidUtcCursor(accepted)).toBe(true)
        expect(accepted === undefined ? exit : decodeCursor(encodeCursor(accepted))).toEqual(exit)
      }),
      { numRuns: 250 },
    )
  })

  it('bounds PageQuery limits strictly to whole integers in 1..POSTS_PAGE_MAX', () => {
    const limits = fc.oneof(
      adversarialString,
      fc.integer({ max: 200, min: -50 }).map(String),
      fc.constantFrom('0', '1', String(POSTS_PAGE_MAX), String(POSTS_PAGE_MAX + 1), '１', ' 5', '5 ', '1e1', '1.0'),
    )
    fc.assert(
      fc.property(fc.option(adversarialString, { nil: undefined }), fc.option(limits, { nil: undefined }), (c, l) => {
        const exit = decodeQuery({ ...(c !== undefined && { cursor: c }), ...(l !== undefined && { limit: l }) })
        const validLimit =
          Exit.isFailure(exit) ||
          exit.value.limit === undefined ||
          (Number.isInteger(exit.value.limit) && exit.value.limit >= 1 && exit.value.limit <= POSTS_PAGE_MAX)
        expect(validLimit).toBe(true)
      }),
      { numRuns: 250 },
    )
  })
})

describe('fuzz stored-text and post-input', () => {
  it('isFreeOfNul admits exactly strings without U+0000', () => {
    fc.assert(
      fc.property(adversarialString, (text) => {
        expect(Schema.is(NulFreeText)(text)).toBe(!text.includes('\u0000'))
      }),
      { numRuns: 250 },
    )
  })

  it('PostInput enforces NUL-free, trimmed, bounded strings without throwing or mutating', () => {
    const payloads = fc.oneof(
      fc.record({ body: adversarialString }),
      fc.record({ body: adversarialString, extra: adversarialString }),
      fc.record({ body: fc.oneof(fc.integer(), fc.boolean(), fc.constant(null), fc.array(fc.string())) }),
      fc.anything({ maxDepth: 2 }),
    )
    fc.assert(
      fc.property(payloads, (payload) => {
        const exit = decodePostInput(payload)
        const ok =
          Exit.isFailure(exit) ||
          (!exit.value.body.includes('\u0000') &&
            exit.value.body === exit.value.body.trim() &&
            exit.value.body.length >= 1 &&
            exit.value.body.length <= POST_MAX_LENGTH &&
            Schema.is(PostBody)(exit.value.body))
        expect(ok).toBe(true)
      }),
      { numRuns: 250 },
    )
  })
})

describe('fuzz account-input', () => {
  it('never throws and preserves field invariants across account schemas', () => {
    const emailLike = fc.oneof(
      adversarialString,
      fc.tuple(adversarialString, adversarialString).map(([local, host]) => `${local}@${host}`),
    )
    fc.assert(
      fc.property(emailLike, adversarialString, adversarialString, (email, name, secret) => {
        const signUp = decodeSignUp({ email, name, password: secret })
        const signUpValid =
          Exit.isFailure(signUp) ||
          (!signUp.value.email.includes('\u0000') &&
            signUp.value.email.length <= 254 &&
            /^[^\s@]+@[^\s@]+$/.test(signUp.value.email) &&
            !signUp.value.name.includes('\u0000') &&
            signUp.value.name === signUp.value.name.trim() &&
            signUp.value.name.length >= 1 &&
            signUp.value.name.length <= 100 &&
            signUp.value.password.length >= PASSWORD_MIN_LENGTH &&
            signUp.value.password.length <= PASSWORD_MAX_LENGTH)
        expect(signUpValid).toBe(true)
        expect(Exit.isExit(decodeSignIn({ email, password: secret }))).toBe(true)
        expect(Exit.isExit(decodeEmail({ email }))).toBe(true)
      }),
      { numRuns: 200 },
    )
  })

  it('never throws on adversarial tokens, password updates, delete fields, and FormData', () => {
    fc.assert(
      fc.property(adversarialString, adversarialString, fc.boolean(), (first, second, confirm) => {
        const tokenExit = decodeToken({ token: first })
        const tokenValid =
          Exit.isFailure(tokenExit) ||
          (!tokenExit.value.token.includes('\u0000') &&
            tokenExit.value.token.length >= 1 &&
            tokenExit.value.token.length <= 2048)
        expect(tokenValid).toBe(true)
        expect(Exit.isExit(decodeSession({ id: first }))).toBe(true)
        expect(Exit.isExit(decodeReset({ newPassword: second, token: first }))).toBe(true)
        expect(Exit.isExit(decodeChange({ currentPassword: first, newPassword: second }))).toBe(true)
        expect(Exit.isExit(decodeDelete({ password: first }))).toBe(true)
        expect(Exit.isExit(decodeDeleteFields({ confirm, password: first }))).toBe(true)
        const form = formOf([
          ['email', confirm ? first : new Blob([first])],
          ['password', second],
          ['redirect', first],
        ])
        expect(Exit.isExit(decodeSignInForm(form))).toBe(true)
      }),
      { numRuns: 200 },
    )
  })
})

describe('fuzz content-security-policy', () => {
  it('always emits all 10 locked-down directives without throwing', () => {
    const safeNonce = fc.stringMatching(/^[A-Za-z0-9+/_=-]{1,64}$/)
    fc.assert(
      fc.property(
        fc.array(adversarialString, { maxLength: 6 }),
        fc.array(adversarialString, { maxLength: 6 }),
        safeNonce,
        (script, style, nonce) => {
          const { 'content-security-policy': customPolicy } = documentHeaders({ script, style })
          expect(customPolicy.split('; ').length).toBeGreaterThanOrEqual(10)
          expect(customPolicy).toContain("object-src 'none'")
          expect(customPolicy).toContain("base-uri 'none'")
          expect(customPolicy).toContain("frame-ancestors 'none'")
          expect(customPolicy).toContain("form-action 'self'")
          const { 'content-security-policy': noncePolicy } = documentHeaders(nonceSources(nonce))
          expect(noncePolicy).not.toMatch(/unsafe-inline|unsafe-eval|\*/)
          expect(noncePolicy).toContain(`'nonce-${nonce}'`)
        },
      ),
      { numRuns: 200 },
    )
  })
})
