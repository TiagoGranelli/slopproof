import '@tanstack/react-start/server-only'
import { drizzleAdapter } from '@better-auth/drizzle-adapter'
import { betterAuth } from 'better-auth'
import { APIError, createAuthMiddleware } from 'better-auth/api'
import { tanstackStartCookies } from 'better-auth/tanstack-start'
import { Redacted } from 'effect'
import { APP_NAME } from '#/config/app.ts'
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '#/contract/limits.ts'
import { scheduleAuthCleanup } from './auth-cleanup.ts'
import { postgresRateLimitStorage } from './auth-rate-limit.ts'
import { runInBackground } from './background-tasks.ts'
import { db } from './db/client.ts'
import * as schema from './db/schema/index.ts'
import { env } from './env.ts'
import { AUTH_BASE_PATH, endpointAllowlist, isExposedEndpoint } from './http/auth-endpoints.ts'
import { IPV6_SUBNET } from './http/client-address.ts'
import { log } from './log.ts'
import { authMail } from './mail/auth-mail.ts'

const requirePasswordToDelete = createAuthMiddleware(async (ctx) => {
  if (ctx.path !== '/delete-user') {
    return
  }
  const body: unknown = ctx.body
  const { password, token }: { password?: unknown; token?: unknown } =
    typeof body === 'object' && body !== null ? body : {}
  if (typeof password !== 'string' || password === '' || token !== undefined) {
    throw APIError.from('BAD_REQUEST', { code: 'INVALID_PASSWORD', message: 'Deleting the account needs its password' })
  }
})

export const auth = betterAuth({
  advanced: {
    backgroundTasks: { handler: runInBackground },
    ipAddress: {
      ipAddressHeaders: ['x-forwarded-for'],
      ipv6Subnet: IPV6_SUBNET,
      trustedProxies: env.trustedProxies,
    },
  },
  appName: APP_NAME,
  basePath: AUTH_BASE_PATH,
  baseURL: env.appUrl,
  database: drizzleAdapter(db, { provider: 'pg', schema }),
  disabledPaths: env.authSignUp === 'open' ? [] : ['/sign-up/email'],
  emailAndPassword: {
    autoSignIn: false,
    enabled: true,
    maxPasswordLength: PASSWORD_MAX_LENGTH,
    minPasswordLength: PASSWORD_MIN_LENGTH,
    onExistingUserSignUp: authMail.existingAccount,
    requireEmailVerification: true,
    revokeSessionsOnPasswordReset: true,
    sendResetPassword: authMail.resetPassword,
  },
  emailVerification: {
    autoSignInAfterVerification: false,
    sendOnSignIn: true,
    sendOnSignUp: true,
    sendVerificationEmail: authMail.verifyEmail,
  },
  hooks: { before: requirePasswordToDelete },
  logger: {
    level: env.isProduction ? 'warn' : 'info',
    log: (level, message, ...args) => log(level, message, { error: args[0], source: 'better-auth' }),
  },
  onAPIError: { throw: true },
  plugins: [endpointAllowlist(), tanstackStartCookies()],
  rateLimit: {
    // Better Auth matches the first key in customRules, so /get-session must precede the catch-all.
    // oxlint-disable-next-line perfectionist/sort-objects
    customRules: { '/get-session': false, '/**': (request, rule) => (isExposedEndpoint(request) ? rule : false) },
    customStorage: postgresRateLimitStorage,
    enabled: env.isProduction,
    max: 100,
    window: 60,
  },
  secret: Redacted.value(env.authSecret),
  user: { deleteUser: { enabled: true } },
})

scheduleAuthCleanup()
