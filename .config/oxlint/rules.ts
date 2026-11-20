import type { OxlintConfig } from 'oxlint'

/** The rules for every file, on top of @nkzw/oxlint-config. */
export const rules: NonNullable<OxlintConfig['rules']> = {
  // On Windows pnpm, npm and node_modules/.bin tools are `.cmd` shims, which Node refuses to start without a shell
  // (CVE-2024-27980); tinyexec resolves them and escapes their arguments for cmd.exe.
  'eslint-js/no-restricted-syntax': [
    'error',
    {
      message:
        'Start pnpm, npm or a node_modules/.bin tool with `xSync` or `x` from tinyexec, not node:child_process: on Windows it is a `.cmd` shim, which Node refuses to start without a shell (CVE-2024-27980).',
      selector:
        'CallExpression:matches([callee.name=/^(spawn|spawnSync|execFile|execFileSync)$/], [callee.property.name=/^(spawn|spawnSync|execFile|execFileSync)$/])[arguments.0.value=/^(pnpm|npm|npx|yarn)$|^node_modules/]',
    },
  ],
  'eslint/no-underscore-dangle': [
    'error',
    {
      allow: ['_tag'],
    },
  ],
  'import/no-unassigned-import': [
    'error',
    {
      allow: ['@tanstack/react-start/server-only', '**/*.css'],
    },
  ],
  'oxc/no-barrel-file': ['error', { threshold: 0 }],
  'react/no-unstable-nested-components': [
    'error',
    {
      allowAsProps: true,
    },
  ],
  'react/react-in-jsx-scope': 'off',
  'react/rules-of-hooks': 'error',
  'typescript/await-thenable': 'error',
  'typescript/consistent-return': 'off',
  'typescript/no-floating-promises': 'error',
  'typescript/no-misused-promises': [
    'error',
    {
      checksVoidReturn: {
        attributes: false,
      },
    },
  ],
  'typescript/no-unsafe-type-assertion': 'off',
  'typescript/switch-exhaustiveness-check': 'error',
  'unicorn/filename-case': ['error', { case: 'kebabCase' }],

  // pedantic, turned off. Style preferences that would rewrite correct code, or rules that fight a library's shape.
  'eslint/max-classes-per-file': 'off',
  'eslint/require-unicode-regexp': 'off',
  'import/max-dependencies': 'off',
  'typescript/prefer-readonly-parameter-types': 'off',
  'typescript/strict-void-return': 'off',
  'unicorn/explicit-length-check': 'off',
  // `new Promise((resolve) => setTimeout(resolve, ms))` is the idiom it flags.
  'eslint/no-promise-executor-return': 'off',
  'unicorn/no-useless-undefined': 'off',
  // Its fix changes behavior: `Number.parseFloat("2px")` is 2, `Number("2px")` is NaN (CSS values in tests/e2e).
  'unicorn/prefer-number-coercion': 'off',
  // Better Auth hooks and TanStack loaders must be async functions even when they await nothing.
  'eslint/require-await': 'off',
  'typescript/require-await': 'off',
  // Style rules this repository does not adopt.
  'eslint/no-loop-func': 'off',
  'eslint/no-negated-condition': 'off',
  'unicorn/no-negated-condition': 'off',
  'unicorn/prefer-query-selector': 'off',

  // pedantic, calibrated.
  // Nullable strings, booleans and objects read naturally in conditions; numbers and any/unknown do not
  // (`if (count)` hides 0, `if (error)` hides a falsy thrown value).
  'typescript/strict-boolean-expressions': [
    'error',
    {
      allowAny: false,
      allowNullableBoolean: true,
      allowNullableEnum: false,
      allowNullableNumber: false,
      allowNullableObject: true,
      allowNullableString: true,
      allowNumber: true,
      allowString: true,
    },
  ],
  // TanStack Router's `throw redirect(...)` and `throw notFound()` are its control flow.
  'eslint/eqeqeq': ['error', 'always', { null: 'ignore' }],
  'typescript/no-confusing-void-expression': ['error', { ignoreArrowShorthand: true }],
  'typescript/only-throw-error': [
    'error',
    {
      allow: [{ from: 'package', name: ['Redirect', 'NotFoundError'], package: '@tanstack/router-core' }],
    },
  ],
  'typescript/prefer-nullish-coalescing': ['error', { ignorePrimitives: { boolean: true, string: true } }],

  // Mistakes agents make: type escapes, dead conditions, suppressed checks, leftovers.
  'typescript/consistent-type-assertions': 'error',
  'typescript/consistent-type-imports': 'error',
  'typescript/dot-notation': 'error',
  'typescript/no-dynamic-delete': 'error',
  'typescript/no-empty-object-type': 'error',
  'typescript/no-explicit-any': 'error',
  'typescript/no-import-type-side-effects': 'error',
  'typescript/no-inferrable-types': 'error',
  'typescript/no-invalid-void-type': 'error',
  'typescript/no-namespace': 'error',
  'typescript/no-non-null-assertion': 'error',
  'typescript/no-require-imports': 'error',
  'typescript/no-unnecessary-condition': 'error',
  'typescript/prefer-optional-chain': 'error',
  'typescript/use-unknown-in-catch-callback-variable': 'error',
  // `@ts-expect-error` needs a reason of at least 10 characters; `@ts-ignore` and `@ts-nocheck` are banned.
  'eslint/no-console': 'error',
  'eslint/no-empty': ['error', { allowEmptyCatch: false }],
  'eslint/no-new-func': 'error',
  'eslint/no-script-url': 'error',
  'eslint/no-warning-comments': ['error', { terms: ['todo', 'fixme', 'xxx', 'hack'] }],
  'import/extensions': ['error', 'always', { ignorePackages: true }],
  'import/first': 'error',
  'import/no-duplicates': 'error',
  // Drizzle takes the schema module itself (`drizzle({ schema })`), two type maps are keyed by every export of a
  // module (`keyof typeof Sdk`, `keyof typeof AuthFunctions`), and fast-check's API is `fc.*` (its default export
  // trips import/no-named-as-default-member).
  'import/no-namespace': [
    'error',
    {
      ignore: [
        '**/db/schema/index.ts',
        './schema/index.ts',
        '#/sdk/sdk.gen.ts',
        '#/lib/auth.functions.ts',
        'fast-check',
      ],
    },
  ],
  'promise/no-nesting': 'error',
  'promise/no-return-in-finally': 'error',
  'promise/no-return-wrap': 'error',
  'promise/prefer-catch': 'error',
  'react/button-has-type': 'error',
  'react/jsx-no-target-blank': 'error',
  'react/no-danger': 'error',
  'typescript/ban-ts-comment': [
    'error',
    {
      minimumDescriptionLength: 10,
      'ts-check': false,
      'ts-expect-error': 'allow-with-description',
      'ts-ignore': true,
      'ts-nocheck': true,
    },
  ],
  'typescript/no-implied-eval': 'error',
  'unicorn/no-abusive-eslint-disable': 'error',
  // React Compiler bailouts: code the compiler cannot optimize, or a suppressed rule of React.
  'eslint/complexity': ['error', { max: 20 }],
  'jsx-a11y/anchor-ambiguous-text': 'error',
  'react/invariant': 'error',
  'react/rule-suppression': 'error',
  'react/syntax': 'error',
  'react/todo': 'error',
  'react/unsupported-syntax': 'error',

  // Code style for agents (AGENTS.md, "Code style"): a file and a function fit one read, nesting stays shallow,
  // names grep. Comments are not counted, so nobody deletes a "why" to pass.
  'eslint/max-depth': ['error', { max: 2 }],
  'eslint/max-lines': ['error', { max: 300, skipBlankLines: true, skipComments: true }],
  'eslint/max-lines-per-function': ['error', { max: 20, skipBlankLines: true, skipComments: true }],
  // Effect's idiom is three deep: `Effect.fn` > `.handle(...)` > `CurrentUser.use(...)`.
  'eslint/max-nested-callbacks': ['error', { max: 3 }],
  'eslint/max-params': ['error', { max: 3 }],
  'eslint/no-nested-ternary': 'error',
  'react/jsx-max-depth': ['error', { max: 4 }],
  'unicorn/error-message': 'error',
  // Names that say nothing and grep everywhere. `data` and `handler(s)` are keys TanStack Start, TanStack Query and
  // Effect impose (`signIn({ data })`, `server: { handlers }`), so AGENTS.md covers them instead.
  'eslint/id-denylist': [
    'error',
    'result',
    'results',
    'info',
    'item',
    'obj',
    'tmp',
    'temp',
    'val',
    'foo',
    'bar',
    'manager',
    'helper',
    'helpers',
    'util',
    'utils',
  ],

  // TanStack Query and Router (ESLint plugins run by oxlint).
  '@tanstack/query/exhaustive-deps': 'error',
  '@tanstack/query/no-rest-destructuring': 'error',
  '@tanstack/query/prefer-query-options': 'error',
  '@tanstack/query/stable-query-client': 'error',
  '@tanstack/router/create-route-property-order': 'error',

  // React effects: every rule from eslint-plugin-react-you-might-not-need-an-effect's strict config (ADR 0017).
  // Product code (src/**) bans useEffect/useLayoutEffect/useInsertionEffect outright in boundaries.ts; these rules
  // also guard tests and explain the React replacement for any effect pattern.
  'react-you-might-not-need-an-effect/no-adjust-state-on-prop-change': 'error',
  'react-you-might-not-need-an-effect/no-chain-state-updates': 'error',
  'react-you-might-not-need-an-effect/no-derived-state': 'error',
  'react-you-might-not-need-an-effect/no-event-handler': 'error',
  'react-you-might-not-need-an-effect/no-external-store-subscription': 'error',
  'react-you-might-not-need-an-effect/no-initialize-state': 'error',
  'react-you-might-not-need-an-effect/no-pass-data-to-parent': 'error',
  'react-you-might-not-need-an-effect/no-pass-live-state-to-parent': 'error',
  'react-you-might-not-need-an-effect/no-reset-all-state-on-prop-change': 'error',

  'shadcn/no-arbitrary-values': 'error',
  'shadcn/no-inline-styles': 'error',
  'shadcn/no-raw-colors': 'error',
  'shadcn/no-restyle': [
    'error',
    {
      allow: ['layout'],
      contracts: [
        {
          allow: ['layout', 'spacing'],
          pattern: '^CardContent$',
        },
      ],
    },
  ],
  'shadcn/no-unknown-classes': 'error',
  'shadcn/require-static-classes': 'error',
}
