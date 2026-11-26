---
name: security-review
description: Verify security boundaries, STRIDE controls, and threat-model invariants before finishing changes to API endpoints, server functions, auth, schemas, migrations, CSP, logging, or deployment configs.
---

# Security review

Read [docs/security/threat-model.md](../../../docs/security/threat-model.md) first so every check aligns with the repo's trust boundaries, STRIDE controls, and automated tests.

## When to run

Run this review before hand-off whenever a change touches:

- `src/contract/**`, `src/server/api/**`, or `src/routes/api/**`
- `src/lib/*.functions.ts`, `src/server/auth*`, or `src/server/http/**`
- `src/server/db/schema/**`, `drizzle/**`, or `scripts/migrate.ts`
- `src/start.ts`, `src/router.tsx`, `src/lib/content-security-policy.ts`, or `src/server/nitro/**`
- `src/server/env.ts`, `src/server/log.ts`, `Dockerfile`, or `deploy/**`

## Checklist

1. **Request surface ([ADR 0013](../../../docs/decisions/0013-three-request-surfaces.md)):**
   - Business operations live in Effect `HttpApi` (`src/contract/`, `src/server/api/handlers.ts`), not raw Start server routes.
   - Account actions live in `src/lib/auth.functions.ts` (`callAuthEndpoint`) and `EXPOSED` (`src/server/http/auth-endpoints.ts`), not `HTTP_ENDPOINTS`, unless a non-browser client genuinely needs them.
2. **Authentication and authorization:**
   - Authenticated API endpoints sit under `/api/me/*` behind `Authentication`.
   - Any new unauthenticated endpoint is deliberately added to `PUBLIC_OPERATIONS` in `tests/api/public-operations.test.ts` with a clear reason.
   - Every read/update/delete on user-owned data scopes SQL `WHERE` clauses by `CurrentUser.id` (no IDOR/BOLA) and does not leak existence of other users' rows.
3. **Input validation and abuse limits:**
   - Server functions use `.validator(Schema.toStandardSchemaV1(...))` with narrowed schemas.
   - Every stored or queried string starts with `isFreeOfNul` (`src/contract/stored-text.ts`) and has explicit bounds in `src/contract/limits.ts`.
   - Entity IDs use branded schemas from `src/contract/ids.ts`, never raw `Schema.String`.
   - Mutating API endpoints apply `WriteRateLimit` (or an explicit rate limit) and `RequestValidation`.
   - Redirect targets pass through `safeRedirect` (`src/features/auth/utils/safe-redirect.ts`).
4. **CSRF, headers, caching, and CSP ([ADR 0010](../../../docs/decisions/0010-content-security-policy.md)):**
   - State-changing requests rely on `src/start.ts` CSRF and 64 KiB body-limit middleware—never bypass them.
   - No `'unsafe-inline'`, `'unsafe-eval'`, inline `style="..."`, or `on*` handlers; head scripts/styles go through route `head()` for nonce/hash stamping.
   - User-specific responses and `/api/*` keep `no-store` / `private, no-store` so caches never share user data.
5. **Secrets, PII, and error hygiene:**
   - New secrets in `src/server/env.ts` use `Redacted.Redacted` and validate without echoing values.
   - Errors across trust boundaries return safe generic answers (`Error('Internal error')` for server functions, empty `500` for API/auth defects) and log via `log()` (`src/server/log.ts`) without cookies, tokens, emails, passwords, or raw SQL parameters.
   - Any new metrics or audit metadata omit PII and enforce auth/network guards on internal endpoints (such as `/metrics`).
6. **Database, runtime permissions, and deploy ([ADR 0012](../../../docs/decisions/0012-node-permission-model.md)):**
   - Migrations follow expand/contract, pass `pnpm check:migrations` (squawk), and keep applied migrations immutable.
   - Server code works under Node `--permission --allow-fs-read=/app/.output --allow-net` and Kubernetes `readOnlyRootFilesystem: true`.
   - Proxy changes preserve `Host`, `Origin`, `Referer`, `Sec-Fetch-*`, strict `X-Forwarded-For` handling (`trusted_proxies_strict`), and exact `TRUSTED_PROXIES` alignment.
   - Update [docs/security/threat-model.md](../../../docs/security/threat-model.md) if a new asset, trust boundary, or STRIDE control was introduced.

## Verification

Run the matching gates before hand-off:

- Always: `pnpm check` (covers `fallow security`, `repo-policy`, `migrations`, `licenses`, unit/api/component tests including `tests/api/public-operations.test.ts`).
- When auth, headers, CSP, DB, or server behavior changed: `pnpm build && pnpm verify:app` (covers `tests/integration/security.test.ts`, `csp.test.ts`, `db-failure.test.ts`, `auth-client-ip.test.ts`, `auth-rate-limit.test.ts`, `posts-rate-limit.test.ts`, and E2E CSP/auth specs).
- When `deploy/` or `Dockerfile` changed: `pnpm ci:workflows` (and `pnpm ci:docker` for image/permission-model verification).
