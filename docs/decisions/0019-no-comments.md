# 0019: No prose or JSDoc comments in code

Status: Accepted (2026-11-20)

## Context

`AGENTS.md` previously asked for "why" comments and a JSDoc sentence on every export of `src/server`, `src/lib`, and
`src/features/*/{api,utils}`. Across 334 TypeScript files that produced 2,249 comments (808 JSDoc blocks and 1,400
line comments).

Comments are not checked by the compiler, the linter, or the test suite. When code changes, comments drift out of
sync and become misleading claims that coding agents trust over the implementation—or excuses used to justify
workarounds instead of fixing names, types, or boundaries. Following Dominik "Poteto" Tsai's recommendation to ban
~99% of comments in agent-maintained repositories, prose and JSDoc comments should be banned mechanically so every
surviving comment is anchored to a live tool check.

## Decision

- Add a local Oxlint JS plugin (`.config/oxlint/no-comments-plugin.ts`, registered as `repo` in `oxlint.config.ts`)
  enforcing `repo/no-comments: 'error'` across every linted JS/TS file (`src/**`, `tests/**`, `scripts/**`,
  `.config/oxlint/**`, and `*.config.ts`). Generated files (`src/sdk/**`, `src/routeTree.gen.ts`) remain ignored by
  Oxlint, and non-JS config/migration files (`drizzle/*.sql`, `.fallowrc.json`, `tsconfig.json`, `pnpm-workspace.yaml`,
  `.config/lefthook.yml`) are unaffected.
- Allow only comments anchored to a machine-checked tool directive:
  - Tool directives themselves: `oxlint-disable-next-line` / `eslint-disable-next-line` (checked by
    `reportUnusedDisableDirectives: 'error'`), `fallow-ignore-next-line` / `fallow-ignore-file`, `@ts-expect-error`
    (checked by `tsrs` and `typescript/ban-ts-comment`), `@effect-expect-leaking` / `@effect-diagnostics` (checked by
    `@effect/tsgo`), `v8 ignore`, `oxfmt-ignore`, `@vite-ignore`, triple-slash `<reference>` directives, and shebangs.
  - Exactly one standalone `//` reason line directly above a next-line directive (required by
    `tests/unit/repo-policy.test.ts`). Multi-line essays, detached lines, empty `//` lines, and trailing inline
    comments before a directive are rejected.
- Reverse the `AGENTS.md` JSDoc-on-exports rule: intent is expressed through clear symbol/module names, branded types,
  lint error messages, tests, and ADRs (`docs/decisions/`).
- Unit-test `noCommentsRule` with Oxlint's `RuleTester` in `tests/unit/no-comments.test.ts`.
- Refactor `saveThemeChoice` in `src/lib/theme.ts` to extract `persistThemeChoice` instead of relying on a commented
  empty `catch {}` block.

## Evidence (2026-11-20)

- Comment audit before vs after across 335 linted TypeScript files:
  - Before: 2,249 comments (22 line directives, 19 directive reasons, 808 JSDoc blocks including 1 `@effect-expect-leaking`, 1,400 line comments).
  - Removed: 2,207 comments (98.13%).
  - Remaining: 42 comments (18 `oxlint-disable-next-line`, 1 `fallow-ignore-next-line`, 19 single-line reasons directly
    above them, 3 `@ts-expect-error` lines, and 1 `@effect-expect-leaking` JSDoc block on `Authentication` in
    `src/contract/middleware.ts`).
- `tests/unit/no-comments.test.ts`: 13/13 `RuleTester` cases pass (valid directives, strings containing `//`, shebang,
  and all 7 rejected comment shapes including JSX `{/* ... */}`, JSDoc, stacked reasons, and trailing comments).
- `pnpm check`, `pnpm build && pnpm verify:app`, `pnpm verify:tla`, and `pnpm verify:ui-properties` all pass.

## Consequences

- No comment in JS/TS code can silently rot: when a suppression becomes unnecessary, the tool fails the build until
  both the directive and its one-line reason are removed.
- Removing comment partitions inside object literals caused `perfectionist/sort-objects` to sort the remaining
  unsorted object literals alphabetically; `customRules` in `src/server/auth.ts` keeps its reasoned
  `oxlint-disable-next-line perfectionist/sort-objects`.
- Because `scripts/format-edited-file.ts` runs Oxlint on every edit, agents receive the `repo/no-comments` error
  immediately if they attempt to write a prose comment.

## Revisit when

- This repository publishes a standalone npm library package whose consumers rely on IDE hover JSDoc generated from
  source `.d.ts` files: scope an exception strictly to that package's public entrypoint exports.
