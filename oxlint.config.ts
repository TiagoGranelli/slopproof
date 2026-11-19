import nkzw from '@nkzw/oxlint-config/with-sorting'
import { defineConfig } from 'oxlint'
import { boundaries } from './.config/oxlint/boundaries.ts'
import { overrides } from './.config/oxlint/overrides.ts'
import { rules } from './.config/oxlint/rules.ts'

export default defineConfig({
  extends: [nkzw],
  ignorePatterns: [
    'node_modules/**',
    '.output/**',
    '.nitro/**',
    '.tanstack/**',
    '.fallow/**',
    'drizzle/**',
    '.repos/**',
    'src/sdk/**',
    'src/routeTree.gen.ts',
    'test-results/**',
    'playwright-report/**',
    // Skills, and the agent evals: their hidden checks import tests/<layer> helpers by the path they get when
    // .agents/evals/grade.sh copies them there.
    '.agents/**',
    '.claude/**',
    'lighthouse-report/**',
    'coverage/**',
  ],
  jsPlugins: [
    '@shadcn/lint',
    '@tanstack/eslint-plugin-query',
    '@tanstack/eslint-plugin-router',
    'eslint-plugin-playwright',
    // ESLint's core rules, for `no-restricted-syntax`, which oxlint has no native version of. The object form,
    // because the plain specifier resolves the wrong plugin name (oxc#23695).
    { name: 'eslint-js', specifier: 'oxlint-plugin-eslint' },
  ],
  plugins: ['typescript', 'unicorn', 'oxc', 'import', 'react', 'jsx-a11y', 'promise', 'vitest'],
  // Every rule is "error" or "off" (`pnpm lint` runs with --deny-warnings). `pedantic` is on as a whole; each rule
  // turned off below was measured on this code base and says why. An escape hatch for one line is an
  // `oxlint-disable-next-line <rule>` directly under a comment giving the reason (tests/unit/repo-policy.test.ts
  // rejects a bare one, and `reportUnusedDisableDirectives` rejects a stale one).
  //
  // Repository rules are `eslint-js/no-restricted-syntax` selectors in the overrides at the end. An override
  // replaces the whole selector list of an earlier one, so each list repeats the selectors of the wider globs.
  categories: {
    correctness: 'error',
    pedantic: 'error',
    perf: 'error',
    suspicious: 'error',
  },
  options: {
    reportUnusedDisableDirectives: 'error',
  },
  overrides: [...overrides, ...boundaries],
  rules,
  settings: {
    shadcn: {
      note: 'Theme tokens live in src/styles/app.css; shadcn primitives live in src/components/ui (add new ones with `pnpm exec shadcn add`).',
    },
  },
})
