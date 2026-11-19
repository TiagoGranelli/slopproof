import type { OxlintOverride } from 'oxlint'

/** Per-path exceptions and additions: the contract's wire order, UI primitives, server code, tests and scripts. */
export const overrides: Array<OxlintOverride> = [
  {
    // Effect Schema encodes a struct's fields, and HttpApi lists security schemes, in declaration order: in
    // src/contract that order is the JSON on the wire, openapi.json and the generated SDK.
    files: ['src/contract/**'],
    rules: {
      'perfectionist/sort-objects': 'off',
    },
  },
  {
    // TanStack Router infers each route option's types from the ones before it, so
    // `@tanstack/router/create-route-property-order` fixes their order; alphabetical sorting would undo it.
    files: ['src/routes/**', 'src/router.tsx'],
    rules: {
      'perfectionist/sort-objects': 'off',
    },
  },
  {
    // A table's columns are listed in the order of its CREATE TABLE: drizzle-kit writes new migrations in that order.
    files: ['src/server/db/schema/**'],
    rules: {
      'perfectionist/sort-objects': 'off',
    },
  },
  {
    // Drizzle's schema entry: drizzle-kit (drizzle.config.ts), scripts/check-drift.ts and `drizzle({ schema })`
    // need every table in one module. The only barrel file allowed.
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
    // A component's markup is part of its body: 20 lines of logic plus room for its JSX at printWidth 120. It must
    // stay before the tests/** override, which turns the rule off (a later override wins).
    files: ['**/*.tsx'],
    rules: {
      'eslint/max-lines-per-function': ['error', { max: 80, skipBlankLines: true, skipComments: true }],
    },
  },
  {
    // Server and plumbing modules declare what they return. UI code is exempt: components return JSX and hooks
    // return TanStack generics that would restate the generated SDK's types.
    files: ['src/server/**', 'src/lib/**', 'src/contract/**', 'scripts/**'],
    rules: {
      'typescript/explicit-module-boundary-types': 'error',
    },
  },
  {
    // Except the Drizzle schema's shared column builders: their type is Drizzle's record of the column's name,
    // nullability, default and key, which the table infers from them; spelled out, it restates Drizzle internals.
    files: ['src/server/db/schema/columns.ts'],
    rules: {
      'typescript/explicit-module-boundary-types': 'off',
    },
  },
  {
    // The Effect API takes its dependencies from Layers (Database, PostsRepo, RateLimitStore, SessionLookup), so
    // tests/api can provide fakes. Module singletons and drivers stay out of it. A feature's repository is
    // `src/server/<feature>/repo.ts`, so a new one is covered as it is. No later override may set
    // no-restricted-imports on these paths: it would replace this list.
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
    // UI code and page routes: data only through the SDK or a server function (AGENTS.md, "Architecture map").
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
    // Vitest and Playwright share the test API shape the vitest plugin checks.
    files: ['tests/**'],
    plugins: ['vitest'],
    rules: {
      'typescript/no-non-null-assertion': 'off',
      // A `describe` callback is a list of tests, not a function to keep short. Test bodies are held to 15
      // statements instead (a `describe` holds far fewer statements than lines), and files to max-lines.
      'eslint/max-lines-per-function': 'off',
      'eslint/max-statements': ['error', { max: 15 }],
      // describe > it.effect > Effect.gen > callback.
      'eslint/max-nested-callbacks': ['error', { max: 4 }],
      // `.only` runs one test alone; `.skip` and `.todo` ship a test that checks nothing. A skip that depends on
      // the platform takes a condition (`it.skipIf(...)`).
      'vitest/expect-expect': [
        'error',
        {
          assertFunctionNames: ['expect', 'expect.*', 'assert.*', 'expectAccessible', 'tabOrder'],
        },
      ],
      'vitest/no-conditional-expect': 'error',
      'vitest/no-disabled-tests': 'error',
      'vitest/no-duplicate-hooks': 'error',
      'vitest/no-focused-tests': 'error',
      'vitest/no-identical-title': 'error',
      'vitest/prefer-hooks-on-top': 'error',
      'vitest/require-mock-type-parameters': 'error',
      'vitest/warn-todo': 'error',
      // pedantic: flags every `??`, ternary and callback in a test body (29 findings, none a hidden branch of the
      // test itself). no-conditional-expect above catches the harmful case: an assertion that may not run.
      'vitest/no-conditional-in-test': 'off',
      'vitest/no-standalone-expect': [
        'error',
        {
          additionalTestBlockFunctions: ['beforeAll', 'beforeEach', 'afterEach'],
        },
      ],
      'vitest/valid-expect': [
        'error',
        {
          maxArgs: 2,
        },
      ],
    },
  },
  {
    files: ['scripts/**', 'tests/**'],
    rules: {
      'no-await-in-loop': 'off',
    },
  },
  {
    // Command-line tools: the console is their output.
    files: ['scripts/**'],
    rules: {
      'eslint/complexity': ['error', { max: 30 }],
      'eslint/no-console': 'off',
    },
  },
]
