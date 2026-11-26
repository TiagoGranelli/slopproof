# Changelog

Notable changes to the template, newest first, in the [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
format. Versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html) as it applies to a template:
a minor version may change what adopters must do when they take it, and says so under "Upgrade notes". Each
release is a `vX.Y.Z` tag; [docs/adopting.md](docs/adopting.md#staying-current) explains how to take one into a
repository created from the template.

## [Unreleased]

## [0.2.0] - 2026-11-26

### Added

- **Fast local agentic feedback:** `pnpm check:changed` (`scripts/check-changed.ts`) runs incremental formatting, lint, TypeScript/Effect checks, related Vitest tests (skipping Chromium when UI files are untouched), `fallow`, `squawk`, and targeted drift checks in parallel during iteration; `.claude/settings.json`'s `PostToolUse` hook (`scripts/format-edited-file.ts`) adds instant ADR 0017/0019 guards, `squawk` checks on new SQL migrations, and `additionalContext` hints.
- **Verification & formal proofs:** explicit UI state charts, `fast-check` model/fuzz tests (`tests/unit/fuzz-parsers.test.ts`, `tests/api/fuzz-contract.test.ts`), TLA+ TLC specs (`specs/`, `pnpm verify:tla`, cached in CI `repo-guards`), and Bombadil autonomous browser property exploration (`pnpm verify:ui-properties`, ADR 0018).
- **Zero-bloat mutation, performance & security gates:** incremental parallel TypeScript mutation runner (`pnpm verify:mutate`), Vitest hot-path benchmarks (`pnpm verify:bench`), 10k-row Postgres `EXPLAIN (FORMAT JSON)` index plan gate (`tests/db/query-plans.test.ts`), k6/Node load & soak suites (`pnpm verify:load`, `pnpm verify:soak`), OpenAPI-driven active DAST (`pnpm verify:dast`), Playwright visual regression (`pnpm verify:visual`), Caddyfile & `fly.toml` validation (`pnpm check:caddy`), and nightly workflow `.github/workflows/deep-gates.yml` (`schedule` + `workflow_dispatch`).
- **Observability, audit & operations:** W3C `traceparent` / `x-request-id` correlation (`src/server/request-context.ts`, `src/server/log.ts`), Effect native metrics + `/metrics` (Bearer-protected via `METRICS_TOKEN` and blocked with `404` at Caddy edge) + OTLP exporter (`src/server/observability/telemetry.ts`), redacted server error reporting (`src/server/observability/error-reporter.ts`), client telemetry/error hook (`src/lib/client-telemetry.ts`), immutable `audit_log` table (`drizzle/0010_audit_log.sql`, `src/server/audit/audit-log.ts`), typed runtime feature flags (`src/server/feature-flags.ts`), chaos/fault-injection integration tests (`tests/integration/chaos.test.ts`), STRIDE threat model (`docs/security/threat-model.md`), SLOs & release recipes (`docs/slos.md`), and operational runbooks (`docs/runbooks/`).
- **Agent architecture & rules:** branded IDs (`PostId`, `UserId`), `Redacted` credentials, ADR 0016 (`tsrs` + `@nkzw/oxlint-config`), ADR 0017 (ban `useEffect`/timers in product code), ADR 0019 (ban prose/JSDoc comments in code), and project skills `feature-map` (`docs/agents/features.json`) and `security-review`.

### Changed

- **CI speed & runner efficiency:** parallelized workflows, browserless E2E seed, cached Caddy binary, cached `tla2tools.jar`, cached Grype vulnerability DB, preinstalled Chrome for Lighthouse, non-blocking Windows static gate, and consolidated verify jobs — cutting 15-job PR CI to ~2m19s wall-clock (~27–29 billed minutes).
- **Parallel local checks:** `.config/lefthook.yml` runs top-level checks and `drift-*` jobs in parallel (`pnpm check` ~9 s), and `scripts/check-drift.ts` validates OpenAPI/SDK generation in an isolated temporary directory without modifying `src/sdk` during concurrent runs.
- **Dependencies & toolchain:** upgraded to Node `26.13.1`, pnpm `12.23.0`, TypeScript `7.0.2`, Effect `4.1.5`, `@tanstack/react-start` `1.169.7`, Nitro `3.0.261103-rc`, Better Auth `1.7.28`, Drizzle `0.45.4`, `nodemailer` `10.6.1`, Vite `8.3.8`, Vitest `5.1.2`, Playwright `1.64.1`, `@axe-core/playwright` `4.14.1`, Oxlint `1.95.0`, Oxfmt `0.80.0`, Fallow `3.48.0`, `@nkzw/oxlint-config` `4.1.0`, `tsrs` `7.1.0-beta.tsrs5`, `lefthook` `2.2.3`, `tinyexec` `1.4.0`, `@types/node` `26.6.10`, `@types/react` `19.3.2`, and updated `.github/CODEOWNERS` + docs (`README.md` with new architecture diagrams).
- **Lighthouse stability:** Chrome runs with `--renderer-process-limit=1` (preserving `navigationStart` traces) and retries temporary profile cleanup on shutdown races.

### Fixed

- Hardened `LoadMoreList` failure ownership, pagination revision tracking, cancellation responsiveness, and focus handoff; resolved Bombadil Unicode truncation, dialog backdrop focus, and sign-out cache findings; fixed RFC 4007 IPv6 zone-ID parsing in `src/server/http/client-address.ts` and Windows CI security/setup paths.

### Security

- Resolved npm advisories published since `0.1.0` (`nodemailer`, transitive `body-parser`, `undici`, `fast-uri`, `hono`, `ip-address`, `source-map-js`, `js-yaml`), masked unknown `/_serverFn/<id>` errors (`src/lib/server-function-errors.ts`, ADR 0009), and blocked external access to `/metrics` at the Caddy edge.

### Upgrade notes

- Apply the new audit log migration (`pnpm db:migrate` for `drizzle/0010_audit_log.sql`) and inspect optional new environment variables in `.env.example` (`METRICS_TOKEN`, `OTEL_EXPORTER_OTLP_ENDPOINT`, `FEATURE_FLAGS`).
- Start 1.169 removed `requestHandler` and made `getResponseHeaders()` read-only: write cookies with `appendResponseHeader('set-cookie', ...)`, and run code in a request scope with `createServerEntry`.
- MSW 3 renames `onUnhandledRequest` to `onUnhandledFrame`, and `worker.stop()` waits for requests still in flight: release `held()` responses (`tests/component/setup.ts`).
- Run `pnpm exec playwright install` for Playwright `1.64.1`, and review the expanded gate protection entries in `.github/CODEOWNERS`.

## [0.1.0] - 2026-10-01

The first version of the template.

### Added

- One Node service with server-rendered React (TanStack Start), an Effect HttpApi business API with its
  OpenAPI document and a generated Hey API client, Postgres through Drizzle, and Better Auth sessions with
  email and password, sign-up closed or open (`AUTH_SIGN_UP`), email verification, password reset, session
  management and account deletion.
- An example feature (posts) that exercises every layer, and the recipe to remove it
  ([docs/removing-the-example.md](docs/removing-the-example.md)).
- A `minimal` branch with only the gates, on a small client-side React app, for projects on another stack.
- `GET /api/me`, the signed-in user, which the security tests use as their subject.
- The app's name in two places, `package.json` and `src/config/app.ts`, with neutral internal identifiers
  and a test that keeps it so; renaming is a short manual step ([docs/adopting.md](docs/adopting.md#rename-the-app)).
- Quality gates: `pnpm check` (format, type-aware lint, typecheck, Effect diagnostics, dead code,
  complexity, duplication, security sinks, unit, api and component tests with coverage, drift, migration
  lint, licenses, route accessibility coverage, guards), `pnpm check:drift`, the `db`, integration and E2E
  layers (`pnpm test:db`, `pnpm test`, `pnpm test:e2e`, each starting its own servers on a throwaway
  database, and `pnpm verify:app` to run them all with contract coverage), the Lighthouse gate behind the Caddy
  edge, supply-chain checks, and a Docker smoke test that runs `deploy/compose.production.yaml` and scans the
  image with grype.
- `pnpm ci:local` to run the CI jobs in containers (`.github/compose.ci.yaml`) without GitHub.
- Agent support: `AGENTS.md` with nested files for the server, features and tests, project skills in
  `.agents/skills/`, Claude Code settings that format and lint each edited file, and agent evals in
  `.agents/evals/`.
- Production image, migrations as a bundled script, deploy recipes for one server with Docker Compose and
  Caddy, Fly.io and Kubernetes, and [docs/operations.md](docs/operations.md).
- Adopter guide ([docs/adopting.md](docs/adopting.md)), contributing guide, security policy, code of
  conduct, issue and pull request templates, Renovate, and a release workflow that publishes each tag's
  section of this file.
