import type { OxlintOverride } from 'oxlint'

const TIMER_GLOBALS = [
  {
    message:
      'Imperative setTimeout hides timing behind mutable timers that outlive renders and leak across unmounts. Handle work in the event handler, use CSS transitions/animations, or use Effect Clock/Schedule on the server.',
    name: 'setTimeout',
  },
  {
    message:
      'Imperative setInterval drifts, overlaps slow work, and leaks when cleanup is missed. Subscribe to push events with useSyncExternalStore, or use Effect Schedule on the server.',
    name: 'setInterval',
  },
  {
    message:
      'requestAnimationFrame guesses when the next frame commits and races with React rendering. Run DOM work in a ref callback (synchronous on commit) or use CSS transitions.',
    name: 'requestAnimationFrame',
  },
  {
    message:
      'requestIdleCallback defers work with unpredictable browser-dependent timing and lacks universal support. Load chunks on user interaction (loadOnInteraction) or run work in the event handler.',
    name: 'requestIdleCallback',
  },
] as const

export const overrides: Array<OxlintOverride> = [
  {
    files: ['src/contract/**'],
    rules: {
      'perfectionist/sort-objects': 'off',
    },
  },
  {
    files: ['src/routes/**', 'src/router.tsx'],
    rules: {
      'perfectionist/sort-objects': 'off',
    },
  },
  {
    files: ['src/server/db/schema/**'],
    rules: {
      'perfectionist/sort-objects': 'off',
    },
  },
  {
    files: ['src/server/db/schema/index.ts'],
    rules: {
      'oxc/no-barrel-file': 'off',
    },
  },
  {
    files: ['src/components/ui/**'],
    rules: {
      'shadcn/no-arbitrary-values': 'off',
      'shadcn/no-restyle': 'off',
    },
  },
  {
    files: ['**/*.tsx'],
    rules: {
      'eslint/max-lines-per-function': ['error', { max: 80, skipBlankLines: true, skipComments: true }],
    },
  },
  {
    files: ['src/server/**', 'src/lib/**', 'src/contract/**', 'scripts/**'],
    rules: {
      'typescript/explicit-module-boundary-types': 'error',
    },
  },
  {
    files: ['src/server/db/schema/columns.ts'],
    rules: {
      'typescript/explicit-module-boundary-types': 'off',
    },
  },
  {
    files: ['src/server/api/**', 'src/server/*/repo.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { message: 'Use the Database service (src/server/db/client.ts).', name: 'pg' },
            { message: 'Use authMail (src/server/mail/).', name: 'nodemailer' },
          ],
          patterns: [
            {
              message:
                'The Effect API reads Better Auth through a service provided by a Layer, not the module singleton.',
              regex: String.raw`(^|/)server/auth\.ts$|^\.\./auth\.ts$`,
            },
            {
              importNames: ['db', 'pool'],
              message: 'Use the Database service, provided by a Layer.',
              regex: String.raw`(^|/)db/client\.ts$`,
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/**'],
    rules: {
      'no-restricted-globals': ['error', ...TIMER_GLOBALS],
    },
  },
  {
    files: ['src/components/**', 'src/features/**', 'src/routes/**/*.tsx'],
    plugins: ['node'],
    rules: {
      'no-restricted-globals': [
        'error',
        {
          message:
            'UI code calls the API through the generated SDK (#/sdk) or a server function (#/lib/*.functions.ts), never raw fetch.',
          name: 'fetch',
        },
        ...TIMER_GLOBALS,
      ],
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              message: 'Server-only helpers. Use a server function in #/lib/*.functions.ts.',
              name: '@tanstack/react-start/server',
            },
          ],
          patterns: [
            {
              message:
                'UI code must not import src/server/**. Go through the SDK (#/sdk) or a server function (#/lib/*.functions.ts).',
              regex: '^#/server(/|$)',
            },
            {
              message:
                'UI code must not import src/server/**. Go through the SDK (#/sdk) or a server function (#/lib/*.functions.ts).',
              regex: String.raw`^(\.\./)+server(/|$)`,
            },
            {
              message: 'UI code must not touch the database. Call the API through the generated SDK (#/sdk).',
              regex: '^(drizzle-orm|pg)(/|$)',
            },
            {
              message:
                'Better Auth runs on the server only, its client included. UI code calls the account server functions in #/lib/auth.functions.ts.',
              regex: '^(better-auth|@better-auth)(/|$)',
            },
          ],
        },
      ],
      'node/no-process-env': 'error',
    },
  },
  {
    files: ['src/contract/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['*', '!effect', '!effect/**', '!./*', String.raw`!\#/contract/*`, String.raw`!\#/config/*`],
              message:
                'src/contract is the pure API contract: it may import only `effect`, other src/contract modules and src/config.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['tests/**'],
    plugins: ['vitest'],
    rules: {
      'eslint/max-lines-per-function': 'off',
      'eslint/max-nested-callbacks': ['error', { max: 4 }],
      'eslint/max-statements': ['error', { max: 15 }],
      'typescript/no-non-null-assertion': 'off',
      'vitest/expect-expect': [
        'error',
        {
          assertFunctionNames: ['expect', 'expect.*', 'assert.*', 'expectAccessible', 'tabOrder'],
        },
      ],
      'vitest/no-conditional-expect': 'error',
      'vitest/no-conditional-in-test': 'off',
      'vitest/no-disabled-tests': 'error',
      'vitest/no-duplicate-hooks': 'error',
      'vitest/no-focused-tests': 'error',
      'vitest/no-identical-title': 'error',
      'vitest/no-standalone-expect': [
        'error',
        {
          additionalTestBlockFunctions: ['beforeAll', 'beforeEach', 'afterEach'],
        },
      ],
      'vitest/prefer-hooks-on-top': 'error',
      'vitest/require-awaited-expect-poll': 'error',
      'vitest/require-mock-type-parameters': 'error',
      'vitest/valid-expect': [
        'error',
        {
          maxArgs: 2,
        },
      ],
      'vitest/warn-todo': 'error',
    },
  },
  {
    files: ['scripts/**', 'tests/**'],
    rules: {
      'no-await-in-loop': 'off',
      'typescript/no-unsafe-type-assertion': 'off',
    },
  },
  {
    files: ['scripts/**'],
    rules: {
      'eslint/complexity': ['error', { max: 30 }],
      'eslint/no-console': 'off',
    },
  },
]
