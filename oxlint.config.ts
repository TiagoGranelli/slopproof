import nkzw from '@nkzw/oxlint-config/with-sorting'
import { defineConfig } from 'oxlint'
import { boundaries } from './.config/oxlint/boundaries.ts'
import { overrides } from './.config/oxlint/overrides.ts'
import { rules } from './.config/oxlint/rules.ts'

export default defineConfig({
  categories: {
    correctness: 'error',
    pedantic: 'error',
    perf: 'error',
    suspicious: 'error',
  },
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
    'eslint-plugin-react-you-might-not-need-an-effect',
    { name: 'eslint-js', specifier: 'oxlint-plugin-eslint' },
    { name: 'repo', specifier: './.config/oxlint/no-comments-plugin.ts' },
  ],
  options: {
    reportUnusedDisableDirectives: 'error',
  },
  overrides: [...overrides, ...boundaries],
  plugins: ['typescript', 'unicorn', 'oxc', 'import', 'react', 'jsx-a11y', 'promise', 'vitest'],
  rules,
  settings: {
    shadcn: {
      note: 'Theme tokens live in src/styles/app.css; shadcn primitives live in src/components/ui (add new ones with `pnpm exec shadcn add`).',
    },
  },
})
