# 0018: Explicit UI state charts, fast-check model tests, TLA+ server specs, and Bombadil browser properties

Status: Accepted (2026-11-20)

## Context

After banning React effect hooks and imperative timers in product code (ADR 0017), three classes of subtle bugs
remained possible for both humans and coding agents:

1. **Implicit UI state machines.** The post editor (`MyPost` + `EditPostForm`), account forms (`AuthForm`), and
   load-more pagination (`LoadMoreList`) still tracked lifecycle state through parallel booleans and refs
   (`editing` + `returnFocus` + `update.isPending` + `update.isError`; `loadFailed` + `pendingFocus` +
   `lastFocusedError` + `pending` + `error`; `focusIndex` + query flags). Parallel booleans allow impossible
   combinations and invite double submits, stale error alerts, or dropped focus.
2. **Server concurrency invariants.** Two server algorithms rely on subtle interleaving guarantees across
   concurrent requests and instances: the PostgreSQL atomic upsert and background idle pruning in
   `src/server/auth-rate-limit.ts`, and `(created_at, id)` keyset pagination under concurrent creates, edits,
   and deletes in `src/server/db/keyset.ts` and `src/server/posts/repo.ts`. Unit and integration tests cover
   fixed schedules, not every interleaving.
3. **Browser-wide UI invariants under arbitrary user paths.** Example-based E2E tests check authored happy and
   error paths, not arbitrary sequences of clicks, scrolls, reloads, back/forward navigation, and modal dialogs.

Following Dominik "Poteto" Tsai's recommendation for agent-friendly verification, we adopt explicit state charts,
model-based property testing (`fast-check`), TLA+ model checking (TLC), and Bombadil autonomous browser property
testing.

## Decision

### 1. Explicit UI state charts as plain typed transition tables

Model UI transitions with pure reducers next to their features. React's `useReducer` owns local transitions,
and React Query owns fetch state. These flows use no effects or timers.

- **Post editor** (`src/features/posts/utils/post-editor-machine.ts`): `viewing`, `editing`, `saving`,
  `save-failed`, `cancelled` (with explicit `focusTarget` and `restoredBody`). Owned by `MyPost`, passed to
  `EditPostForm`. `MyPost` keeps its `<Suspense>` boundary mounted across view and edit states and wraps `OPEN`
  in React 19 `startTransition` so focus stays on the Edit button until `EditPostForm` resolves and focuses the
  textarea.
- **Auth forms** (`src/features/auth/utils/auth-form-machine.ts`): `idle`, `validating`, `submitting`,
  `field-error` (with `focusFirstInvalid` + `issues`), `form-error`, `succeeded`. Owned by
  `useAuthFormController` in `src/features/auth/components/auth-form.tsx` and used by all eight account forms
  (`LoginForm`, `SignUpForm`, `ForgotPasswordForm`, `ResetPasswordForm`, `ChangePasswordForm`,
  `DeleteAccountForm`, `VerifyEmailForm`, `ResendVerificationForm`).
- **Load-more pagination** (`src/components/lists/load-more-machine.ts`). React Query's next-page busy and error
  flags drive button feedback. The reducer tracks the current request token and the ID of the first item in an
  appended page, so a superseded request cannot move focus. A click during a refresh shows the busy label and
  joins the refresh. If the refresh succeeds without appending a page and more pages remain, pagination uses
  the refreshed cursor. A refresh failure leaves the button available and does not surface a Load more error.

We chose plain typed reducers over XState v5 (`xstate`). The flows have flat state and add no production
dependencies. TypeScript and `typescript/switch-exhaustiveness-check` enforce exhaustiveness, and all three
reducers sit in `COVERAGE_GATE` (`vitest.config.ts`) at 100% lines and branches.

### 2. Model-based property tests in `pnpm check`

Using `fast-check` (`4.10.2`, already installed), add `fc.commands` / `fc.modelRun` tests for every pure machine
(`tests/unit/post-editor-machine.test.ts`, `tests/unit/auth-form-machine.test.ts`,
`tests/unit/load-more-machine.test.ts`) and `fc.commands` / `fc.asyncModelRun` browser tests driving the rendered
components in Chromium (`tests/component/post-editor-properties.test.tsx`,
`tests/component/auth-form-properties.test.tsx`, `tests/component/load-more-properties.test.tsx`). These run
inside `pnpm test:fast` and `pnpm check`.

### 3. TLA+ specifications and TLC runner (`pnpm verify:tla`)

Add TLA+ specifications in `specs/`:

- `specs/RateLimit.tla` + `.cfg`: models two-step multi-instance `Date.now()` capture + atomic PostgreSQL
  `INSERT ... ON CONFLICT DO UPDATE` + background `pruneIdleRows` (`src/server/auth-rate-limit.ts`). Checks
  `NeverExceedsWindowLimit`, `CountTracksAdmitted`, `RefusedNeverExtendsWindow`, `PositiveRetryAfter`, and
  `PruneNeverDeletesActiveWindow`.
- `specs/KeysetPagination.tla` + `.cfg`: models `PostsRepo` concurrent create/edit/delete interleaved with
  `keyset`/`toPage` pagination (`src/server/db/keyset.ts`, `src/server/posts/repo.ts`). Checks
  `NoDuplicatePostIds`, `StrictlyDecreasingKeys`, `NoSkippedSurvivingPosts`, and `OwnershipPreserved`.

`scripts/tla.ts` (`pnpm verify:tla`) downloads pinned `tla2tools.jar` `v1.7.4` into `~/.cache/tla2tools/v1.7.4`
after verifying its SHA-256 (`936a262061c914694dfd669a543be24573c45d5aa0ff20a8b96b23d01e050e88`) and runs TLC
using native `java` when available or a pinned JRE container (`eclipse-temurin:21-jre-alpine@sha256:ac05c3c4...`)
via Docker. No jar or binary is committed.

`verify:tla` is kept as its own script rather than inside `pnpm verify:app` because the CI Playwright `verify`
container does not bundle Java or Docker-in-Docker.

### 4. Bombadil browser property tests (`pnpm verify:ui-properties`)

Install `@antithesishq/bombadil` pinned exactly to `0.7.10` as a devDependency (supply-chain verified via pnpm
SLSA provenance, `minimumReleaseAge`, and lockfile SHA-512; no binary committed).

Add `tests/bombadil/app.ts` checking:

- `noUncaughtExceptions`, `noUnhandledPromiseRejections`, `noConsoleErrors`
- `singleH1AndMainLandmark` (every loaded page has one `<h1>` and one `<main>`)
- `focusNeverDroppedToBodyAfterAction` (interactive actions on a page never drop `document.activeElement` to
  `document.body`)
- `noServerErrorResponses` (zero HTTP 5xx navigations or subresources, plus server log check in the runner)
- `noCspViolations` (zero `securitypolicyviolation` events and zero CSP console errors)

`scripts/ui-properties.ts` (`pnpm verify:ui-properties`) boots the built app via `scripts/app-server.ts` on a
throwaway Postgres database, seeds 12 posts, launches Playwright's headless Chromium over CDP, and runs Bombadil
against both anonymous (`/`) and signed-in (`/dashboard`) sessions with `--instrument-javascript ""` (disabling
Bombadil's in-flight inline-script rewriting so `/about`'s strict SHA-256 hash-based CSP runs unmodified).

`verify:ui-properties` stays a standalone script rather than part of `pnpm check` or `pnpm verify:app` because
Bombadil performs randomized time-bounded exploration (~25 s for both passes).

### 5. Lean 4 skipped

Lean 4 is not installed here, and neither candidate pure module benefits from a Lean proof today:

- `src/features/auth/utils/safe-redirect.ts` derives its security from the browser/Node WHATWG `URL` parser and
  `decodeURIComponent`; proving a Lean re-specification would create a spec-to-runtime gap, whereas
  `tests/unit/safe-redirect.test.ts` already exercises the real WHATWG `URL` parser with 2,000+ `fast-check`
  properties at 100% branch coverage.
- `src/server/db/keyset.ts` is mostly Drizzle SQL template construction plus a 6-line slice (`toPage`); its
  concurrency invariants under concurrent writes are already exhaustively model-checked by
  `specs/KeysetPagination.tla` and exercised against Postgres in `tests/db/keyset.test.ts`.

## Evidence (2026-11-20)

- **Real bug caught by Bombadil on the first runs:** clicking `Edit` on `/dashboard` before the lazy
  `EditPostForm` chunk finished loading unmounted the focused Edit button into a newly-mounted `<Suspense
  fallback={<PostCard busy />}>` and dropped `document.activeElement` to `document.body` (reported in 0.186 s,
  and caught again until the `<Suspense>` boundary itself stayed mounted across view/edit states). Keeping
  `<Suspense>` mounted around both states and wrapping `OPEN` in React 19 `startTransition` keeps the Edit
  button mounted and focused until `EditPostForm` resolves and focuses the textarea; subsequent Bombadil runs
  passed with zero violations.
- **TLA+ (TLC v1.7.4 via pinned Docker JRE):**
  - `KeysetPagination`: 24,095 distinct states (181,894 generated) in ~1.6 s — 0 errors, 0 deadlocks.
  - `RateLimit`: 14,199 distinct states (57,488 generated) in ~1.1 s — 0 errors, 0 deadlocks.
- **fast-check property tests:** 600 pure machine model runs (up to 40 commands each) in ~0.14 s and 3 rendered
  Chromium browser model suites in ~3.8 s, with 100% line and branch coverage on all three state machines.
- **Bombadil (`pnpm verify:ui-properties`):** both `public` and `authenticated` passes passed with zero
  property violations, zero CSP violations, and zero HTTP 5xx server logs.
- **Gates:** full `pnpm check`, `pnpm build && pnpm verify:app`, `pnpm verify:tla`, and
  `pnpm verify:ui-properties` all green.

## Consequences

- Stateful UI flows have one typed source of truth (`useReducer` over an explicit transition function) that
  agents can read in one file and verify with model-based properties without guessing implicit boolean states.
- Server concurrency invariants (`RateLimit`, `KeysetPagination`) have executable specifications that TLC checks
  exhaustively in under 3 seconds.
- `pnpm check` stays fast (only unit/api/component tests, including the fast-check model tests), while heavy
  formal/browser exploration runs on demand via `pnpm verify:tla` and `pnpm verify:ui-properties`.

## Revisit when

- A UI flow grows nested/parallel states, invoked async actors, or visual statechart tooling needs that exceed
  flat discriminated unions: adopt `xstate` v5 (exact pin) for that flow.
- CI adds a dedicated formal-verification job with Java or Docker available: run `pnpm verify:tla` (and an
  optional time-bounded `pnpm verify:ui-properties` job) in CI.
- The codebase introduces a self-contained algorithmic kernel (for example, a custom authorization policy engine,
  CRDT merge, or binary cursor codec) whose correctness does not depend on browser/SQL runtime parsers: evaluate
  a Lean 4 proof for that kernel.
