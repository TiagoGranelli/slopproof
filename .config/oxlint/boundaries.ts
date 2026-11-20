import type { OxlintOverride } from 'oxlint'

const SPAWN_SELECTOR = {
  message:
    'Start pnpm, npm or a node_modules/.bin tool with `xSync` or `x` from tinyexec, not node:child_process: on Windows it is a `.cmd` shim, which Node refuses to start without a shell (CVE-2024-27980).',
  selector:
    'CallExpression:matches([callee.name=/^(spawn|spawnSync|execFile|execFileSync)$/], [callee.property.name=/^(spawn|spawnSync|execFile|execFileSync)$/])[arguments.0.value=/^(pnpm|npm|npx|yarn)$|^node_modules/]',
} as const

/** Syntax rules enforced across all of `src/**`, including the raw API routes. */
const SRC_CORE_SELECTORS = [
  SPAWN_SELECTOR,
  {
    message:
      '`as unknown as` switches the type checker off. Decode the value with Effect Schema, or fix the type where it comes from.',
    selector: "TSAsExpression > TSAsExpression.expression[typeAnnotation.type='TSUnknownKeyword']",
  },
  {
    message:
      'CORS does not belong in application code: the app is same-origin (src/start.ts rejects other origins). Serving other origins is a reviewed edge decision in deploy/Caddyfile.',
    selector:
      'Literal[value=/access-control-allow-origin/i], TemplateElement[value.raw=/access-control-allow-origin/i]',
  },
  {
    message:
      'import.meta.env.VITE_* is compiled into the browser bundle, so its value is public. Read server configuration through src/server/env.ts.',
    selector: "MemberExpression[object.object.type='MetaProperty'][object.property.name='env'][property.name=/^VITE_/]",
  },
  // React effect hooks and member-accessed/imported timers (ADR 0017; bare timer globals are in overrides.ts).
  {
    message:
      'useEffect runs after paint and on every dependency change; agents misjudge its timing. Derive during render, handle it in the event handler, use a ref callback for DOM work, or useSyncExternalStore for subscriptions.',
    selector:
      "ImportDeclaration[source.value='react'] ImportSpecifier[imported.name='useEffect'], CallExpression[callee.name='useEffect'], MemberExpression[property.name='useEffect']",
  },
  {
    message:
      'useLayoutEffect blocks paint and runs on every dependency change; agents misjudge its timing. Measure or focus in a ref callback, or derive layout state during render.',
    selector:
      "ImportDeclaration[source.value='react'] ImportSpecifier[imported.name='useLayoutEffect'], CallExpression[callee.name='useLayoutEffect'], MemberExpression[property.name='useLayoutEffect']",
  },
  {
    message:
      'useInsertionEffect is reserved for CSS-in-JS libraries to inject stylesheets before layout. Style with Tailwind classes or put head styles through the route head().',
    selector:
      "ImportDeclaration[source.value='react'] ImportSpecifier[imported.name='useInsertionEffect'], CallExpression[callee.name='useInsertionEffect'], MemberExpression[property.name='useInsertionEffect']",
  },
  {
    message:
      'Imperative setTimeout hides timing behind mutable timers that outlive renders and leak across unmounts. Handle work in the event handler, use CSS transitions/animations, or use Effect Clock/Schedule on the server.',
    selector:
      "MemberExpression[property.name='setTimeout'], MemberExpression[computed=true][property.value='setTimeout'], ImportSpecifier[imported.name='setTimeout']",
  },
  {
    message:
      'Imperative setInterval drifts, overlaps slow work, and leaks when cleanup is missed. Subscribe to push events with useSyncExternalStore, or use Effect Schedule on the server.',
    selector:
      "MemberExpression[property.name='setInterval'], MemberExpression[computed=true][property.value='setInterval'], ImportSpecifier[imported.name='setInterval']",
  },
  {
    message:
      'requestAnimationFrame guesses when the next frame commits and races with React rendering. Run DOM work in a ref callback (synchronous on commit) or use CSS transitions.',
    selector:
      "MemberExpression[property.name='requestAnimationFrame'], MemberExpression[computed=true][property.value='requestAnimationFrame']",
  },
  {
    message:
      'requestIdleCallback defers work with unpredictable browser-dependent timing and lacks universal support. Load chunks on user interaction (loadOnInteraction) or run work in the event handler.',
    selector:
      "MemberExpression[property.name='requestIdleCallback'], MemberExpression[computed=true][property.value='requestIdleCallback']",
  },
] as const

const VALIDATOR_SELECTOR = {
  message:
    "A server function's validator is the only check between the network and its handler. Decode with Effect Schema: `.validator(Schema.toStandardSchemaV1(Schema.Struct({ ... })))`.",
  selector:
    "CallExpression[callee.property.name=/^(inputValidator|validator)$/]:not([arguments.0.callee.object.name='Schema'][arguments.0.callee.property.name='toStandardSchemaV1'])",
} as const

const SRC_SELECTORS = [...SRC_CORE_SELECTORS, VALIDATOR_SELECTOR] as const

const TEST_SELECTORS = [
  SPAWN_SELECTOR,
  {
    message: 'expect(<literal>) asserts on a constant, so it can never fail. Put the value under test in expect(...).',
    selector:
      "CallExpression[callee.name='expect'][arguments.0.type='Literal'], CallExpression[callee.name='expect'][arguments.0.type='TemplateLiteral'][arguments.0.expressions.length=0], CallExpression[callee.name='expect'][arguments.0.type='Identifier'][arguments.0.name='undefined']",
  },
] as const

/** Repository rules per directory, as syntax selectors and restricted imports. */
export const boundaries: Array<OxlintOverride> = [
  // Repository rules as syntax selectors. Each list repeats the selectors of the wider globs above it.
  {
    files: ['src/**'],
    rules: {
      'eslint-js/no-restricted-syntax': ['error', ...SRC_SELECTORS],
    },
  },
  {
    // An id is a string to the API and a brand to the compiler (src/contract/ids.ts).
    files: ['src/contract/**'],
    rules: {
      'eslint-js/no-restricted-syntax': [
        'error',
        ...SRC_SELECTORS,
        {
          message:
            'An id in the contract is branded, so the compiler refuses one kind of id where another is expected. Use the brand from src/contract/ids.ts (`PostId`, `UserId`), or add one there for a new table.',
          selector:
            "Property[key.name=/^(id|[a-z][A-Za-z]*Id)$/] > MemberExpression.value[object.name='Schema'][property.name='String']",
        },
      ],
    },
  },
  {
    // Only the two raw routes below serve HTTP themselves; everything else goes through the API contract.
    files: ['src/routes/**'],
    rules: {
      'eslint-js/no-restricted-syntax': [
        'error',
        ...SRC_SELECTORS,
        {
          message:
            'A raw HTTP route bypasses the API contract (no openapi.json entry, no SDK, no Authentication middleware). Add an endpoint to src/contract and src/server/api/handlers.ts instead.',
          selector:
            "Identifier[name='createServerFileRoute'], Property[key.name='server'] > ObjectExpression.value > Property[key.name='handlers']",
        },
      ],
    },
  },
  {
    files: ['src/routes/api/**'],
    rules: {
      'eslint-js/no-restricted-syntax': [
        'error',
        SPAWN_SELECTOR,
        {
          message:
            'src/routes/api holds only the two raw routes, api/$.ts (the Effect API) and api/auth/$.ts (Better Auth). Add an endpoint to src/contract and src/server/api/handlers.ts instead.',
          selector: 'Program',
        },
      ],
    },
  },
  {
    // The two raw routes: the Effect API and Better Auth. A third one is a reviewed edit here, with its reason.
    files: ['src/routes/api/$.ts', 'src/routes/api/auth/$.ts'],
    rules: {
      'eslint-js/no-restricted-syntax': ['error', ...SRC_CORE_SELECTORS],
    },
  },
  {
    files: ['tests/**'],
    rules: {
      'eslint-js/no-restricted-syntax': ['error', ...TEST_SELECTORS],
    },
  },
  {
    // Layers that wait for a browser or a server.
    files: ['tests/component/**', 'tests/integration/**', 'tests/e2e/**'],
    rules: {
      'eslint-js/no-restricted-syntax': [
        'error',
        ...TEST_SELECTORS,
        {
          message:
            'A fixed wait is flaky on a slow machine and slow on a fast one. Wait for the condition itself: web-first `await expect(locator)...`, `expect.element`, `expect.poll` or `vi.waitFor`.',
          selector:
            'CallExpression[callee.name=/^(setTimeout|sleep)$/], CallExpression[callee.property.name=/^(setTimeout|sleep)$/]',
        },
      ],
    },
  },
  {
    // Playwright's own rules: oxlint's vitest rules do not recognize Playwright's `test`.
    files: ['tests/e2e/**'],
    rules: {
      'playwright/no-focused-test': 'error',
      // A skip that depends on the browser takes a condition: `test.skip(({ isMobile }) => isMobile, 'reason')`.
      'playwright/no-skipped-test': ['error', { allowConditional: true, disallowFixme: true }],
      'playwright/no-wait-for-timeout': 'error',
    },
  },
]
