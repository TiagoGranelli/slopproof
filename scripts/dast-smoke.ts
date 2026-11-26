import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { startApp } from './app-server.ts'
import type { RunningApp } from './app-server.ts'
import { dropTestDatabase, testDatabaseUrl } from './test-db.ts'

export const ZAP_IMAGE =
  'ghcr.io/zaproxy/zaproxy:2.17.0@sha256:9624669db72f54d86c4b46a7064518bd9bf79d8c61a4c31befa9923489f328af'

type OpenApiSpec = {
  paths: Record<string, Record<string, { security?: Array<Record<string, Array<string>>> }>>
}

type ProbeOutcome = { detail: string; name: string; ok: boolean }
type SessionCookie = { header: string; raw: string }
type AuthContext = { baseUrl: string; otherCookie: string; postId: string; userCookie: string }

const PROTECTED_METHODS = ['get', 'post', 'patch', 'delete', 'put'] as const

const extractSessionCookie = (response: Response): SessionCookie => {
  const raw = response.headers.getSetCookie().find((entry) => entry.includes('session_token=')) ?? ''
  return { header: raw.split(';', 1)[0] ?? '', raw }
}

const signInWithCookies = async (
  baseUrl: string,
  account: { email: string; password: string },
): Promise<SessionCookie> => {
  const response = await fetch(`${baseUrl}/api/auth/sign-in/email`, {
    body: JSON.stringify(account),
    headers: { 'content-type': 'application/json', origin: baseUrl },
    method: 'POST',
  })
  await response.arrayBuffer()
  const parsed = extractSessionCookie(response)
  if (!response.ok || !parsed.header) {
    throw new Error(`dast sign-in failed (${response.status})`)
  }
  return parsed
}

const checkCookieAttributes = (rawCookie: string): ProbeOutcome => {
  const lower = rawCookie.toLowerCase()
  const ok = lower.includes('httponly') && /samesite=(lax|strict)/.test(lower) && lower.includes('path=/')
  return {
    detail: ok ? 'HttpOnly, SameSite=Lax|Strict, Path=/ verified' : `weak session cookie attributes: ${rawCookie}`,
    name: 'cookie-attributes',
    ok,
  }
}

const securedOperations = (): Array<{ method: string; pathTemplate: string }> => {
  const spec = JSON.parse(readFileSync('openapi.json', 'utf8')) as OpenApiSpec
  return Object.entries(spec.paths).flatMap(([pathTemplate, operations]) =>
    PROTECTED_METHODS.flatMap((method) =>
      (operations[method]?.security?.length ?? 0) > 0 ? [{ method, pathTemplate }] : [],
    ),
  )
}

const probeUnauthOperation = async (baseUrl: string, method: string, pathTemplate: string): Promise<string | null> => {
  const concrete = pathTemplate.replaceAll(/\{[^}]+\}/g, crypto.randomUUID())
  const needsBody = method === 'post' || method === 'patch'
  const res = await fetch(`${baseUrl}${concrete}`, {
    body: needsBody ? JSON.stringify({ body: 'unauth probe' }) : undefined,
    headers: { 'content-type': 'application/json', origin: baseUrl },
    method: method.toUpperCase(),
  })
  await res.arrayBuffer()
  return res.status === 401 ? null : `${method.toUpperCase()} ${pathTemplate} returned ${res.status} without auth`
}

const checkUnauthOpenApiPaths = async (baseUrl: string): Promise<ProbeOutcome> => {
  const failures: Array<string> = []
  for (const { method, pathTemplate } of securedOperations()) {
    const issue = await probeUnauthOperation(baseUrl, method, pathTemplate)
    if (issue) {
      failures.push(issue)
    }
  }
  const forged = await fetch(`${baseUrl}/api/me`, { headers: { cookie: 'better-auth.session_token=forged.token' } })
  await forged.arrayBuffer()
  if (forged.status !== 401) {
    failures.push(`GET /api/me returned ${forged.status} with forged cookie`)
  }
  return {
    detail: failures.length ? failures.join('; ') : 'every secured OpenAPI operation rejected unauthenticated requests',
    name: 'openapi-auth-bypass',
    ok: failures.length === 0,
  }
}

const sendCrossUserMutation = async (ctx: AuthContext, method: 'PATCH' | 'DELETE'): Promise<string | null> => {
  const res = await fetch(`${ctx.baseUrl}/api/me/posts/${ctx.postId}`, {
    body: method === 'PATCH' ? JSON.stringify({ body: 'cross-user hijack attempt' }) : undefined,
    headers: { 'content-type': 'application/json', cookie: ctx.otherCookie, origin: ctx.baseUrl },
    method,
  })
  await res.arrayBuffer()
  return res.status === 403 || res.status === 404 ? null : `cross-user ${method} answered ${res.status}`
}

const checkIdorBola = async (ctx: AuthContext): Promise<ProbeOutcome> => {
  const failures = [await sendCrossUserMutation(ctx, 'PATCH'), await sendCrossUserMutation(ctx, 'DELETE')].filter(
    (entry): entry is string => entry !== null,
  )
  const verify = await fetch(`${ctx.baseUrl}/api/me/posts`, { headers: { cookie: ctx.userCookie } })
  const payload = (await verify.json()) as { items?: Array<{ body: string; id: string }> }
  const intact = payload.items?.some((post) => post.id === ctx.postId && post.body === 'dast baseline post') ?? false
  if (!intact) {
    failures.push('owner post was altered or removed by another user')
  }
  return {
    detail: failures.length ? failures.join('; ') : 'cross-user PATCH/DELETE rejected and owner post intact',
    name: 'idor-bola',
    ok: failures.length === 0,
  }
}

const csrfProbeCases = (ctx: AuthContext) => {
  const headersList: Array<[string, Record<string, string>]> = [
    ['missing-origin', { cookie: ctx.userCookie }],
    ['foreign-origin', { cookie: ctx.userCookie, origin: 'https://evil.example' }],
    ['cross-site-fetch-metadata', { cookie: ctx.userCookie, origin: ctx.baseUrl, 'sec-fetch-site': 'cross-site' }],
  ]
  const mutations: Array<[string, string, string | undefined]> = [
    ['POST', '/api/me/posts', JSON.stringify({ body: 'csrf probe' })],
    ['PATCH', `/api/me/posts/${ctx.postId}`, JSON.stringify({ body: 'csrf edit' })],
    ['DELETE', `/api/me/posts/${ctx.postId}`, undefined],
  ]
  return headersList.flatMap(([label, headers]) =>
    mutations.map(([method, path, body]) => ({ body, headers, label, method, path })),
  )
}

const checkCsrfEnforcement = async (ctx: AuthContext): Promise<ProbeOutcome> => {
  const failures: Array<string> = []
  for (const probe of csrfProbeCases(ctx)) {
    const res = await fetch(`${ctx.baseUrl}${probe.path}`, {
      body: probe.body,
      headers: { 'content-type': 'application/json', ...probe.headers },
      method: probe.method,
    })
    await res.arrayBuffer()
    if (res.status !== 403) {
      failures.push(`${probe.method} ${probe.path} (${probe.label}) returned ${res.status}`)
    }
  }
  return {
    detail: failures.length ? failures.join('; ') : 'all POST/PATCH/DELETE CSRF probes rejected with 403',
    name: 'csrf-enforcement',
    ok: failures.length === 0,
  }
}

const METHOD_PROBES: ReadonlyArray<[string, string]> = [
  ['PUT', '/api/health'],
  ['DELETE', '/api/posts'],
  ['POST', '/api/posts'],
  ['PUT', '/api/me'],
]

const checkMethodConfusion = async (baseUrl: string): Promise<ProbeOutcome> => {
  const failures: Array<string> = []
  for (const [method, path] of METHOD_PROBES) {
    const res = await fetch(`${baseUrl}${path}`, { headers: { origin: baseUrl }, method })
    await res.arrayBuffer()
    if (res.status !== 404 && res.status !== 405) {
      failures.push(`${method} ${path} answered ${res.status}`)
    }
  }
  return {
    detail: failures.length ? failures.join('; ') : 'unsupported HTTP methods returned 404/405',
    name: 'method-confusion',
    ok: failures.length === 0,
  }
}

const REQUIRED_HEADERS: ReadonlyArray<[string, string]> = [
  ['x-content-type-options', 'nosniff'],
  ['x-frame-options', 'DENY'],
  ['cross-origin-opener-policy', 'same-origin'],
]

const routeHeaderIssues = (path: string, headers: Headers): Array<string> => {
  const issues = REQUIRED_HEADERS.flatMap(([name, expected]) =>
    headers.get(name) === expected ? [] : [`${path} missing ${name}: ${expected}`],
  )
  const csp = headers.get('content-security-policy') ?? ''
  const blocksObjects = csp.includes("object-src 'none'") || csp.includes("default-src 'none'")
  if (!csp.includes("frame-ancestors 'none'") || !blocksObjects) {
    issues.push(`${path} CSP missing frame-ancestors/object-src`)
  }
  if (/unsafe-inline|unsafe-eval/i.test(csp)) {
    issues.push(`${path} CSP permits unsafe-inline or unsafe-eval`)
  }
  return issues
}

const checkSecurityHeaders = async (baseUrl: string, userCookie: string): Promise<ProbeOutcome> => {
  const failures: Array<string> = []
  for (const path of ['/', '/about', '/login', '/api/health', '/api/me']) {
    const res = await fetch(`${baseUrl}${path}`, { headers: path === '/api/me' ? { cookie: userCookie } : {} })
    await res.arrayBuffer()
    failures.push(...routeHeaderIssues(path, res.headers))
    if (path === '/api/me' && res.headers.get('cache-control') !== 'no-store') {
      failures.push('/api/me missing Cache-Control: no-store')
    }
  }
  return {
    detail: failures.length ? failures.join('; ') : 'baseline security headers and strict CSP verified across routes',
    name: 'security-headers-and-csp',
    ok: failures.length === 0,
  }
}

const probeSpoofedSignIns = async (baseUrl: string, email: string): Promise<Array<number>> => {
  const statuses: Array<number> = []
  for (let idx = 1; idx <= 4; idx += 1) {
    const res = await fetch(`${baseUrl}/api/auth/sign-in/email`, {
      body: JSON.stringify({ email, password: 'wrong-password-probe' }),
      headers: { 'content-type': 'application/json', origin: baseUrl, 'x-forwarded-for': `203.0.113.${idx}` },
      method: 'POST',
    })
    await res.arrayBuffer()
    statuses.push(res.status)
  }
  return statuses
}

const checkSpoofingAndRedirects = async (baseUrl: string, email: string): Promise<ProbeOutcome> => {
  const failures: Array<string> = []
  const statuses = await probeSpoofedSignIns(baseUrl, email)
  if (!statuses.includes(429)) {
    failures.push(`X-Forwarded-For spoofing bypassed rate limit (${statuses.join(',')})`)
  }
  for (const probe of ['//evil.example/', String.raw`/\evil.example`]) {
    const res = await fetch(`${baseUrl}${probe}`, { redirect: 'manual' })
    await res.arrayBuffer()
    const location = res.headers.get('location')
    if (location && new URL(location, baseUrl).origin !== new URL(baseUrl).origin) {
      failures.push(`open redirect on ${probe} -> ${location}`)
    }
  }
  return {
    detail: failures.length ? failures.join('; ') : 'X-Forwarded-For spoofing blocked and no open redirects',
    name: 'header-spoofing-and-redirects',
    ok: failures.length === 0,
  }
}

const createOwnerPost = async (baseUrl: string, userCookie: string): Promise<string> => {
  const res = await fetch(`${baseUrl}/api/me/posts`, {
    body: JSON.stringify({ body: 'dast baseline post' }),
    headers: { 'content-type': 'application/json', cookie: userCookie, origin: baseUrl },
    method: 'POST',
  })
  const created = (await res.json()) as { id?: string }
  if (res.status !== 201 || !created.id) {
    throw new Error(`failed to seed owner post for DAST (${res.status})`)
  }
  return created.id
}

const runZapBaseline = (baseUrl: string): ProbeOutcome => {
  const proc = spawnSync(
    'docker',
    ['run', '--rm', '--network', 'host', ZAP_IMAGE, 'zap-baseline.py', '-t', baseUrl, '-m', '1'],
    { stdio: 'inherit' },
  )
  const ok = proc.status === 0 || proc.status === 2
  return { detail: `zap-baseline.py exited with ${proc.status ?? 'signal'}`, name: 'owasp-zap-baseline', ok }
}

export const runDastAudit = async (app: RunningApp, runZap: boolean): Promise<Array<ProbeOutcome>> => {
  const userAuth = await signInWithCookies(app.url, app.user)
  const otherAuth = await signInWithCookies(app.url, app.otherUser)
  const postId = await createOwnerPost(app.url, userAuth.header)
  const ctx: AuthContext = { baseUrl: app.url, otherCookie: otherAuth.header, postId, userCookie: userAuth.header }
  const outcomes: Array<ProbeOutcome> = [
    checkCookieAttributes(userAuth.raw),
    await checkUnauthOpenApiPaths(app.url),
    await checkIdorBola(ctx),
    await checkCsrfEnforcement(ctx),
    await checkMethodConfusion(app.url),
    await checkSecurityHeaders(app.url, userAuth.header),
    await checkSpoofingAndRedirects(app.url, app.user.email),
  ]
  if (runZap) {
    outcomes.push(runZapBaseline(app.url))
  }
  return outcomes
}

const main = async (): Promise<void> => {
  const runZap = process.argv.includes('--zap')
  const databaseUrl = testDatabaseUrl('dast')
  let app: RunningApp | undefined
  try {
    app = await startApp({ databaseUrl, logFile: 'test-results/app-server-dast.log', trustedProxies: '' })
    const outcomes = await runDastAudit(app, runZap)
    for (const outcome of outcomes) {
      console.log(`${outcome.ok ? 'PASS' : 'FAIL'}  ${outcome.name}: ${outcome.detail}`)
    }
    process.exitCode = outcomes.every((entry) => entry.ok) ? 0 : 1
  } finally {
    await app?.stop()
    await dropTestDatabase(databaseUrl)
  }
}

if (import.meta.main) {
  await main()
}
