# 0016: Type checking and type-aware lint through tsrs, on @nkzw/oxlint-config 3

Status: Accepted (2026-11-19)

## Context

`pnpm typecheck` ran `tsc` from `typescript` 7.0.2 (ADR 0002), and type-aware Oxlint ran its rules through
`oxlint-tsgolint`, a second Go build of the same checker. tsrs (oxc-project/tsrs) is a Rust port of the
TypeScript 7 compiler from the Oxc team. It serves both jobs: `tsrs --noEmit` type checks, and Oxlint 1.94 runs
its type-aware rules through it. `@nkzw/oxlint-config` 3.0 needs Oxlint 1.94 and ships a `quality` plugin
(no unknown returns, no open dictionaries of `unknown`, no chained type assertions, no widening of known values)
that fits the repository's rule of parsing at the boundary.

## Decision

- `pnpm typecheck` is `tsrs --noEmit`, pinned to `7.1.0-beta.tsrs3` (TypeScript 7.1.0-beta,
  microsoft/TypeScript@3e9236361fa9). `oxlint-tsgolint` is removed; `oxlint --type-aware` uses tsrs.
- The Oxlint config is `oxlint.config.ts`, which extends `@nkzw/oxlint-config/with-sorting` 3.0.0. The
  repository's own overrides, boundaries and rules live in `.config/oxlint/`, each module under the 300-line
  limit.
- Two of its rules are scoped: `perfectionist/sort-objects` is off in `src/contract/**`, where field order is
  the order of `openapi.json` and the generated SDK, and in `src/routes/**` and `src/router.tsx`, where
  TanStack Router infers types from the order of route options.
- `typescript` 7.0.2 stays: `@tanstack/eslint-plugin-query`, the `@typescript-eslint` packages and
  `fallow-type-aware` load it, and editors use its language service.
- pnpm's trust policy excludes exactly `tsrs@7.1.0-beta.tsrs3` (`pnpm-workspace.yaml` gives the evidence). Its
  first release was a staged publish, which pnpm ranks above the trusted publisher every later release uses.

## Evidence (2026-11-19)

- On this repository, `tsrs --noEmit` takes about 0.27 s and `tsc --noEmit` about 0.8 s; both report no errors.
  The full type-aware lint takes about 1.2 s.
- With every rule of the config on, lint started at 2199 findings. All are fixed in code, with named types,
  `satisfies`, `Json` from `src/contract/json.ts` for parsed payloads, and shorter functions. Four lines keep a
  disable directive with its reason.

## Consequences

The type checker is a beta of TypeScript 7.1 from a port, so a checker bug could hide or invent an error.
`effect-tsgo diagnostics` still runs on the Go build, and the editor uses `typescript` 7.0.2, so a
disagreement shows up as a difference between the editor or the `effect` gate and `pnpm typecheck`.

## Revisit when

- tsrs ships a stable release: move to it and drop the `trustPolicyExclude` entry.
- The bootstrap release is more than 30 days older than the tsrs version in use: drop the
  `trustPolicyExclude` entry.
- `typescript` 7.1 is stable: move `typescript` to it so the editor and the checker agree.
