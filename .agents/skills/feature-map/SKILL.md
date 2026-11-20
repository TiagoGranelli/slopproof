---
name: feature-map
description: Locate where any user-facing feature lives and run its targeted tests without scanning the whole tree. Use at the start of any feature, bug-fix, route, API, or test task to find owning files and at the end to verify the feature.
---

# Feature map

Use the feature map (`docs/agents/features.json`) via `scripts/features.ts` so you open only the files a feature owns and run its targeted verification right away.

## At the start of a task

1. If you have a file path, find which feature owns it:
   ```sh
   node scripts/features.ts where <path>
   ```
2. Otherwise, list every feature to find the id:
   ```sh
   node scripts/features.ts list
   ```
3. Inspect the feature's routes, OpenAPI operations, source paths, tests, and verification command:
   ```sh
   node scripts/features.ts show <id>
   ```

## After making changes

1. Run the feature's fast verification suite:
   ```sh
   node scripts/features.ts verify <id>
   ```
2. If you added, moved, or deleted files under `src/features`, `src/routes`, `src/server/api`, or `src/contract`, or changed `openapi.json`, update `docs/agents/features.json` and check for drift:
   ```sh
   node scripts/features.ts check
   ```
3. Run `pnpm check` before hand-off (its unit test `tests/unit/features.test.ts` runs the same drift check). For changes touching the database, auth, contract, or UI flows, also run the heavier tests listed under `tests` in `show <id>` (`pnpm test:db`, `pnpm test`, `pnpm test:e2e`, or `pnpm build && pnpm verify:app`).
