import { RuleTester } from 'oxlint/plugins-dev'
import { describe, it } from 'vitest'
import { noCommentsRule } from '../../.config/oxlint/no-comments-plugin.ts'

RuleTester.describe = describe
RuleTester.it = it

const tester = new RuleTester({
  languageOptions: {
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
})

tester.run('no-comments', noCommentsRule, {
  invalid: [
    {
      code: '// explains what the line does\nconst count = 1\n',
      errors: [{ message: /ADR 0019/ }],
    },
    {
      code: '/** JSDoc summary */\nexport const count = 1\n',
      errors: [{ message: /ADR 0019/ }],
    },
    {
      code: 'const view = <div>{/* jsx note */}</div>\n',
      errors: [{ message: /ADR 0019/ }],
    },
    {
      code: '// first line of reason\n// second line of reason\n// oxlint-disable-next-line no-console\nconsole.log(1)\n',
      errors: [{ line: 1, message: /ADR 0019/ }],
    },
    {
      code: '// detached reason\n\n// oxlint-disable-next-line no-console\nconsole.log(1)\n',
      errors: [{ line: 1, message: /ADR 0019/ }],
    },
    {
      code: 'const first = 1 // trailing comment\n// oxlint-disable-next-line no-console\nconsole.log(first)\n',
      errors: [{ line: 1, message: /ADR 0019/ }],
    },
    {
      code: '//\n// oxlint-disable-next-line no-console\nconsole.log(1)\n',
      errors: [{ line: 1, message: /ADR 0019/ }],
    },
  ],
  valid: [
    {
      code: 'const url = "https://example.test//not-a-comment"\n',
    },
    {
      code: '#!/usr/bin/env node\nconst ready = true\n',
    },
    {
      code: '// CLI output belongs on stdout.\n// oxlint-disable-next-line no-console\nconsole.log(1)\n',
    },
    {
      code: '// Constant inlined because DDL takes no parameters.\n// fallow-ignore-next-line security-sink\nconst fragment = "x"\n',
    },
    {
      code: '// @ts-expect-error branded id mismatch verified by typecheck\nconst value: number = "x"\n',
      filename: 'sample.ts',
    },
    {
      code: '/**\n * Request middleware reads the request by design:\n * @effect-expect-leaking HttpServerRequest\n */\nexport const middleware = true\n',
    },
  ],
})
