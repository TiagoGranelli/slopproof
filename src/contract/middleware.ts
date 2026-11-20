import { Context } from 'effect'
import { HttpApiMiddleware, HttpApiSecurity, OpenApi } from 'effect/http-api'
import { RateLimited, Unauthorized, ValidationError } from './errors.ts'
import type { UserId } from './ids.ts'

interface SessionUser {
  readonly email: string
  readonly id: UserId
  readonly name: string
}

export class CurrentUser extends Context.Service<CurrentUser, SessionUser>()('app/CurrentUser') {}

const SESSION_COOKIE = 'better-auth.session_token'

/**
 * Request middleware reads the request by design:
 * @effect-expect-leaking HttpServerRequest | ParsedSearchParams | RouteContext
 */
export class Authentication extends HttpApiMiddleware.Service<Authentication, { provides: CurrentUser }>()(
  'app/Authentication',
  {
    error: Unauthorized,
    security: {
      sessionCookie: HttpApiSecurity.apiKey({ in: 'cookie', key: SESSION_COOKIE }).pipe(
        HttpApiSecurity.annotate(OpenApi.Description, 'Better Auth session cookie over http (development).'),
      ),
      secureSessionCookie: HttpApiSecurity.apiKey({ in: 'cookie', key: `__Secure-${SESSION_COOKIE}` }).pipe(
        HttpApiSecurity.annotate(OpenApi.Description, 'Better Auth session cookie when APP_URL is https.'),
      ),
    },
  },
) {}

export class RequestValidation extends HttpApiMiddleware.Service<RequestValidation>()('app/RequestValidation', {
  error: ValidationError,
}) {}

export class WriteRateLimit extends HttpApiMiddleware.Service<WriteRateLimit, { requires: CurrentUser }>()(
  'app/WriteRateLimit',
  { error: RateLimited },
) {}
