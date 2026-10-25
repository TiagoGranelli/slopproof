# Changelog

Notable changes to the template, newest first, in the [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
format. Versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html) as it applies to a template:
a minor version may change what adopters must do when they take it, and says so under "Upgrade notes". Each
release is a `vX.Y.Z` tag; [docs/adopting.md](docs/adopting.md#staying-current) explains how to take one into a
repository created from the template.

## [Unreleased]

### Changed

- Every dependency moved to its newest release at least seven days old (2026-10-18), among them
  `@tanstack/react-start` 1.169.3, Effect 4.0.5, Better Auth 1.7.10, MSW 3.0.3, Playwright 1.64.1, Vite 8.3.4,
  Vitest 5.0.5, `oxfmt` 0.73.0 and the Hey API snapshot `0.0.0-next-20260930190945`; Node 26.12.0 and pnpm
  12.14.0. `lefthook` stops at 2.2.1: 2.2.2 was published without provenance and fails `trustPolicy`.
- The expired release-age exceptions for Better Auth 1.7.7 and Effect 4.0.0 and the `js-yaml` override are
  gone; the Hey API snapshot now depends on a fixed `js-yaml`.
- `@effect/tsgo` 0.53: `schemaClassMissingBrand` is a warning (the tagged errors carry a brand), and
  `unstableApiUsage` is off, since the contract is built on HttpApi, which Effect 4 marks unstable.

### Security

- Start 1.169 serializes an error thrown before a server function runs, so an unknown `/_serverFn/<id>`
  answered with the id and Start's message. A request middleware (`src/lib/server-function-errors.ts`) now
  logs it and answers `Error('Internal error')`, like an error inside a function (ADR 0009).

### Upgrade notes

- Start 1.169 removed `requestHandler` and made `getResponseHeaders()` read-only: write cookies with
  `appendResponseHeader('set-cookie', ...)`, and run code in a request scope with `createServerEntry`.
- MSW 3 renames `onUnhandledRequest` to `onUnhandledFrame`, and `worker.stop()` waits for requests still in
  flight: release `held()` responses (component tests do it in `tests/component/setup.ts`).
- Run `pnpm exec playwright install` for the browsers of Playwright 1.64.1.

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
