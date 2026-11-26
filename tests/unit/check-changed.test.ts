import { describe, expect, it } from 'vitest'
import {
  driftTargetsForFiles,
  isUiComponentFile,
  parseCheckChangedArgs,
  planChecks,
} from '../../scripts/check-changed.ts'
import type { CheckChangedOptions, CheckPlan, DriftTarget, PlannedStep } from '../../scripts/check-changed.ts'
import {
  classifyEditedFile,
  followUpHintForFile,
  inspectEditedSource,
  isActiveMigration,
  isFormatTarget,
  isLintTarget,
  parseSquawkExcludedPaths,
} from '../../scripts/format-edited-file.ts'
import type { EditedFileKind, GuardFinding, HookResponse } from '../../scripts/format-edited-file.ts'

const GRANDFATHERED = new Set(['drizzle/0000_init.sql', 'drizzle/0004_auth_timestamptz.sql'])

const planFor = (files: ReadonlyArray<string>, existing: ReadonlyArray<string> = files, since = 'HEAD'): CheckPlan =>
  planChecks(files, {
    excludedMigrations: GRANDFATHERED,
    existingFiles: new Set(existing),
    since,
  })

const stepNames = (plan: CheckPlan): Array<string> => plan.steps.map((step: PlannedStep) => step.name)

describe('parseCheckChangedArgs', () => {
  it('parses defaults, flags, and normalized file paths', () => {
    const defaults: CheckChangedOptions = parseCheckChangedArgs([])
    expect(defaults).toEqual({ files: [], quiet: false, since: 'HEAD' })
    expect(parseCheckChangedArgs(['--quiet', '--since', 'main', String.raw`./src\server/env.ts`])).toEqual({
      files: ['src/server/env.ts'],
      quiet: true,
      since: 'main',
    })
    expect(parseCheckChangedArgs(['-q', '--since=origin/main', 'scripts/check-changed.ts'])).toEqual({
      files: ['scripts/check-changed.ts'],
      quiet: true,
      since: 'origin/main',
    })
  })

  it('rejects unknown flags and missing --since values', () => {
    expect(() => parseCheckChangedArgs(['--unknown'])).toThrow(/Unknown option/)
    expect(() => parseCheckChangedArgs(['--since'])).toThrow(/requires a git ref/)
    expect(() => parseCheckChangedArgs(['--since', '--quiet'])).toThrow(/requires a git ref/)
    expect(() => parseCheckChangedArgs(['--since='])).toThrow(/non-empty git ref/)
  })
})

describe('UI classification and Chromium skip logic', () => {
  it('detects UI files that require component browser tests', () => {
    const uiFiles = [
      'src/components/errors/api-error-alert.tsx',
      'src/components/lists/load-more-machine.ts',
      'src/routes/dashboard.tsx',
      'src/routes/_authed.ts',
      'src/router.tsx',
      'src/features/posts/components/post-card.tsx',
      'src/features/posts/api/queries.ts',
      'src/styles/app.css',
      'tests/component/post-card.test.tsx',
    ]
    for (const file of uiFiles) {
      expect(isUiComponentFile(file), file).toBe(true)
    }
  })

  it('skips Chromium component tests for server, contract, script, and unit-test edits', () => {
    const nonUiFiles = [
      'src/server/env.ts',
      'src/routes/api/$.ts',
      'src/contract/posts.ts',
      'src/lib/truncate-text.ts',
      'scripts/check-changed.ts',
      'tests/unit/env.test.ts',
    ]
    for (const file of nonUiFiles) {
      expect(isUiComponentFile(file), file).toBe(false)
    }
    const plan = planFor(['src/server/env.ts'])
    expect(plan.uiTriggered).toBe(false)
    expect(plan.skipped).toContain('component')
    expect(plan.steps.find((step) => step.name.startsWith('tests'))?.args).not.toContain('component')
  })

  it('includes Chromium component project when a TSX file changes', () => {
    const plan = planFor(['src/components/errors/api-error-alert.tsx'])
    expect(plan.uiTriggered).toBe(true)
    expect(plan.skipped).not.toContain('component')
    expect(plan.steps.find((step) => step.name.startsWith('tests'))?.args).toContain('component')
  })
})

describe('planChecks gate selection', () => {
  it('runs fallow only when src/ changes and skips drift, migrations, and licenses', () => {
    const serverPlan = planFor(['src/server/env.ts'], ['src/server/env.ts'], 'main')
    expect(stepNames(serverPlan)).toEqual([
      'format',
      'lint',
      'typecheck',
      'tests (unit+api)',
      'fallow-deadcode',
      'fallow-security',
    ])
    expect(serverPlan.steps.find((step) => step.name === 'fallow-deadcode')?.args).toContain('main')
    expect(serverPlan.steps.find((step) => step.name === 'fallow-security')?.args).toContain('--file')
    const scriptPlan = planFor(['scripts/check-changed.ts'])
    expect(stepNames(scriptPlan)).toEqual(['format', 'lint', 'typecheck', 'tests (unit+api)'])
  })

  it('selects exact drift subchecks for contract, schema, and auth edits', () => {
    const contractDrift: Array<DriftTarget> = driftTargetsForFiles(['src/contract/posts.ts'])
    expect(contractDrift).toEqual(['contract'])
    expect(driftTargetsForFiles(['openapi.json'])).toEqual(['contract'])
    expect(driftTargetsForFiles(['src/server/db/schema/posts.ts'])).toEqual(['migrations'])
    expect(driftTargetsForFiles(['src/server/auth.ts'])).toEqual(['auth'])
    expect(driftTargetsForFiles(['src/server/db/schema/auth.ts'])).toEqual(['migrations', 'auth'])
    const authPlan = planFor(['src/server/auth.ts'])
    expect(authPlan.steps.find((step) => step.name.startsWith('drift'))?.args).toEqual([
      'scripts/check-drift.ts',
      'auth',
    ])
  })

  it('triggers squawk only on non-grandfathered migrations and licenses only on manifest edits', () => {
    const newMigration = planFor(['drizzle/0010_audit_log.sql'])
    expect(stepNames(newMigration)).toEqual(['migrations', 'drift (migrations)'])
    const oldMigration = planFor(['drizzle/0000_init.sql'])
    expect(stepNames(oldMigration)).toEqual(['drift (migrations)'])
    const depsPlan = planFor(['package.json'])
    expect(stepNames(depsPlan)).toEqual(['format', 'typecheck', 'licenses'])
    const lockPlan = planFor(['pnpm-lock.yaml'])
    expect(stepNames(lockPlan)).toEqual(['typecheck', 'licenses'])
  })

  it('handles deleted files and markdown-only edits cleanly', () => {
    const deletedPlan = planFor(['src/server/deleted.ts'], [])
    expect(stepNames(deletedPlan)).toEqual(['typecheck', 'fallow-deadcode', 'fallow-security'])
    const docsPlan = planFor(['docs/slos.md'])
    expect(docsPlan.steps).toEqual([])
  })
})

describe('format-edited-file helpers', () => {
  it('parses excluded_paths from squawk.toml and classifies files', () => {
    const parsed = parseSquawkExcludedPaths('excluded_paths = [\n  "drizzle/0000_init.sql",\n]\n')
    expect([...parsed]).toEqual(['drizzle/0000_init.sql'])
    expect(isActiveMigration('drizzle/0000_init.sql', parsed)).toBe(false)
    expect(isActiveMigration('drizzle/0010_next.sql', parsed)).toBe(true)
    const kinds: Array<EditedFileKind> = [
      classifyEditedFile('src/server/env.ts', parsed),
      classifyEditedFile('package.json', parsed),
      classifyEditedFile('drizzle/0010_next.sql', parsed),
      classifyEditedFile('src/sdk/sdk.gen.ts', parsed),
      classifyEditedFile('../outside.ts', parsed),
    ]
    expect(kinds).toEqual(['code', 'format-only', 'migration', 'ignore', 'ignore'])
    expect(isFormatTarget('README.md')).toBe(false)
    expect(isLintTarget('src/routeTree.gen.ts')).toBe(false)
  })

  it('returns targeted follow-up hints for workflow-sensitive paths', () => {
    expect(followUpHintForFile('src/contract/posts.ts')).toContain('pnpm codegen')
    expect(followUpHintForFile('src/server/db/schema/posts.ts')).toContain('pnpm db:generate')
    expect(followUpHintForFile('src/server/auth.ts')).toContain('pnpm check:drift auth')
    expect(followUpHintForFile('drizzle/0010_next.sql')).toContain('pnpm check:migrations')
    expect(followUpHintForFile('package.json')).toContain('pnpm licenses:check')
    expect(followUpHintForFile('src/lib/truncate-text.ts')).toBeUndefined()
  })

  it('flags ADR 0019 comments and banned tokens while allowing valid directives', () => {
    const invalidSource = [
      '// stray comment',
      '// eslint-disable-next-line no-console',
      'const casted = value as unknown as string',
      'setTimeout(() => {}, 10)',
    ].join('\n')
    const findings: Array<GuardFinding> = inspectEditedSource('src/lib/sample.ts', invalidSource)
    expect(findings.map((finding) => finding.line)).toEqual([1, 2, 3, 4])
    const validSource = [
      '// Clock.sleep lacks unref in CLI mode.',
      '// oxlint-disable-next-line no-restricted-globals',
      'setInterval(() => {}, 1000)',
    ].join('\n')
    expect(inspectEditedSource('src/server/auth-cleanup.ts', validSource)).toEqual([])
    expect(inspectEditedSource('scripts/demo.ts', 'setTimeout(() => {}, 10)\n')).toEqual([])
    const blockExample: HookResponse = { decision: 'block', reason: 'fix' }
    expect(blockExample.decision).toBe('block')
  })
})
