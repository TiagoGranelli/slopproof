# 0017: No React effect hooks or imperative timers in product code

Status: Accepted (2026-11-20)

## Context

React's effect hooks (`useEffect`, `useLayoutEffect`, `useInsertionEffect`) and imperative browser/Node timers
(`setTimeout`, `setInterval`, `requestAnimationFrame`, `requestIdleCallback`) hide execution order behind
dependency arrays, post-paint scheduling, and mutable handles. Coding agents routinely misjudge when an effect
fires relative to hydration, paint, and re-renders—producing double submits, stale closures, focus races, and
leaked timers. Following Dominik "Poteto" Tsai's agent-friendly codebase principles, APIs whose correctness
depends on subtle timing should be banned mechanically so the compiler and linter guide every change to the
explicit alternative.

## Decision

- Add `eslint-plugin-react-you-might-not-need-an-effect` (`1.2.0`, exact pin) to `oxlint.config.ts` `jsPlugins`
  and enable every rule of its `strict` config as an error in `.config/oxlint/rules.ts` (`no-derived-state`,
  `no-chain-state-updates`, `no-event-handler`, `no-adjust-state-on-prop-change`,
  `no-reset-all-state-on-prop-change`, `no-pass-live-state-to-parent`, `no-pass-data-to-parent`,
  `no-external-store-subscription`, `no-initialize-state`).
- Ban `useEffect`, `useLayoutEffect`, and `useInsertionEffect` across `src/**` (excluding generated `src/sdk/**`
  and `src/routeTree.gen.ts`) via `eslint-js/no-restricted-syntax` in `.config/oxlint/boundaries.ts`.
- Ban `setTimeout`, `setInterval`, `requestAnimationFrame`, and `requestIdleCallback` across `src/**` via
  `no-restricted-globals` in `.config/oxlint/overrides.ts` and member-access/import selectors in
  `.config/oxlint/boundaries.ts`. Every lint error names the root cause and the replacement pattern.
- Refactor all existing client code to zero disables:
  - Commit-time DOM work (`Page` hydration marker, `AuthStatus` mount focus, `EditPostForm` caret placement,
    `MyPost` return focus, `LoadMoreList` first new item focus, `RouteError` query-boundary reset,
    `FlashMessage` history-state cleanup, `useSchemaSubmit` and `AuthForm` invalid-field focus) uses React 19
    ref callbacks, which run synchronously on commit after child DOM updates.
  - External subscriptions (`RouteAnnouncer` on `router.subscribe('onRendered')`, `useSessionUser` post-hydration
    session load, `minute-clock.ts` relative-time refresh on `visibilitychange`/`focus`/`pageshow`) use
    `useSyncExternalStore`.
- Server periodic maintenance (`src/server/auth-cleanup.ts`) keeps `setInterval(...).unref()` with a single
  reasoned `oxlint-disable-next-line no-restricted-globals`: `auth.ts` calls `scheduleAuthCleanup()` at module
  load time (including from CLI scripts), and Effect v4's `Clock.sleep` creates a ref'd `setTimeout` without
  `.unref()`, which would keep CLI processes alive until the interval expires.

## Evidence (2026-11-20)

- Turning the rules on caught all 10 `useEffect` call sites (3 also tripped
  `react-you-might-not-need-an-effect/no-event-handler`), 1 `requestAnimationFrame` (`field-messages.ts`), and
  2 `setInterval` sites (`minute-clock.ts`, `auth-cleanup.ts`).
- Removing `requestAnimationFrame` from `focusFirstInvalid` eliminated a frame-delay guess: `useSchemaSubmit`
  and `AuthForm` now focus `[aria-invalid="true"]` directly on the commit that writes the attribute.
- All 584 fast tests (unit, API, component), full type-aware lint (0 errors, 0 disables in client code), and
  full E2E/integration verification (`pnpm verify:app`, including `hydration.spec.ts`, `keyboard.spec.ts`,
  `keyboard-actions.spec.ts`, `navigation.spec.ts`, and `a11y.spec.ts`) pass with identical behavior.

## Consequences

- Client code has no hidden post-paint effects or background timers; focus management, hydration readiness, and
  external store subscriptions are explicit in render/commit paths.
- Relative timestamps (`RelativeTime`) refresh on mount, tab visibility change, window focus, and bfcache
  restore rather than waking an idle tab once a minute.
- Any future genuinely imperative DOM/browser integration that cannot be expressed with a ref callback or
  `useSyncExternalStore` requires a reasoned `oxlint-disable-next-line` comment reviewed in code review.

## Revisit when

- Effect v4 exposes an unref'd clock/scheduler option (or periodic server maintenance moves exclusively into a
  long-lived server runtime entry point not imported by CLI scripts): migrate `src/server/auth-cleanup.ts` to
  Effect `Schedule` and remove its single disable directive.
- A feature genuinely requires live ticking while a tab stays continuously focused without interaction (for
  example, a countdown or live telemetry): introduce a single reviewed timer store behind `useSyncExternalStore`
  with explicit lifecycle tests.
