import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  buildCaddyValidateCommand,
  parseFlyToml,
  validateCaddyfile,
  validateFlyToml,
} from '../../scripts/caddy-validate.ts'
import { IMAGES } from '../../scripts/images.ts'

const VALID_FLY_TOML = [
  'app = "sample-app"',
  'kill_signal = "SIGTERM"',
  '',
  '[deploy]',
  'release_command = "node .output/migrate.mjs"',
  '',
  '[env]',
  'TRUSTED_PROXIES = "172.16.0.0/12,fdaa::/16"',
  '',
  '[http_service]',
  'force_https = true',
  '',
  '[[http_service.checks]]',
  'method = "GET"',
  'path = "/api/ready"',
].join('\n')

describe('buildCaddyValidateCommand', () => {
  it('uses CADDY_BIN directly with dummy EDGE_* env vars when configured', () => {
    const plan = buildCaddyValidateCommand('deploy/Caddyfile', '/usr/local/bin/caddy')
    expect(plan.command).toBe('/usr/local/bin/caddy')
    expect(plan.args).toEqual(['validate', '--config', resolve('deploy/Caddyfile'), '--adapter', 'caddyfile'])
    expect(plan.env.EDGE_ADDRESS).toBe('https://app.example.com')
    expect(plan.env.EDGE_UPSTREAM).toBe('app:3000')
    expect(plan.env.EDGE_TRUSTED_PROXIES).toBe('10.0.0.0/8')
  })

  it('uses pinned IMAGES.caddy in an offline read-only Docker container when CADDY_BIN is unset', () => {
    const plan = buildCaddyValidateCommand('deploy/Caddyfile', '')
    expect(plan.command).toBe('docker')
    expect(plan.args).toContain('--rm')
    expect(plan.args).toContain('--network')
    expect(plan.args).toContain('none')
    expect(plan.args).toContain(`${resolve('deploy/Caddyfile')}:/etc/caddy/Caddyfile:ro`)
    expect(plan.args).toContain('EDGE_ADDRESS=https://app.example.com')
    expect(plan.args).toContain(IMAGES.caddy)
    expect(plan.args.slice(-6)).toEqual([
      'caddy',
      'validate',
      '--config',
      '/etc/caddy/Caddyfile',
      '--adapter',
      'caddyfile',
    ])
  })
})

describe('validateCaddyfile', () => {
  it('reports a failure cleanly when the configured CADDY_BIN cannot start', async () => {
    const outcome = await validateCaddyfile('deploy/Caddyfile', 'nonexistent-caddy-binary-for-test')
    expect(outcome.status).toBe(1)
    expect(outcome.output).toContain('did not start')
  })
})

describe('parseFlyToml', () => {
  it('parses root keys, tables, array tables, comments, numbers, booleans and quoted strings', () => {
    const parsed = parseFlyToml(
      [
        '# leading comment',
        'kill_signal = "SIGTERM" # inline comment',
        "literal = 'keep # hash'",
        'kill_timeout = 30',
        '[http_service]',
        'force_https = true',
        '[[http_service.checks]]',
        'path = "/api/ready"',
      ].join('\n'),
    )
    expect(parsed.errors).toEqual([])
    expect(parsed.root).toEqual({ kill_signal: 'SIGTERM', kill_timeout: 30, literal: 'keep # hash' })
    expect(parsed.tables.http_service).toEqual({ force_https: true })
    expect(parsed.arrays['http_service.checks']).toEqual([{ path: '/api/ready' }])
  })

  it('reports malformed headers and assignments', () => {
    const parsed = parseFlyToml(['[bad header]', '[[bad array]]', 'broken line', 'key = "unterminated'].join('\n'))
    expect(parsed.errors.length).toBe(4)
  })
})

describe('validateFlyToml', () => {
  it('accepts the repository deploy/fly.toml', () => {
    const content = readFileSync('deploy/fly.toml', 'utf8')
    expect(validateFlyToml(content)).toEqual([])
  })

  it('accepts a minimal valid fly.toml', () => {
    expect(validateFlyToml(VALID_FLY_TOML)).toEqual([])
  })

  it('flags missing or wrong kill_signal and release_command', () => {
    const broken = VALID_FLY_TOML.replace('SIGTERM', 'SIGINT').replace('node .output/migrate.mjs', 'pnpm db:migrate')
    const problems = validateFlyToml(broken)
    expect(problems).toEqual([
      'deploy/fly.toml: kill_signal must be "SIGTERM" (got "SIGINT")',
      'deploy/fly.toml: [deploy].release_command must be "node .output/migrate.mjs" (got "pnpm db:migrate")',
    ])
  })

  it('flags disabled force_https, wrong healthcheck path, and empty TRUSTED_PROXIES', () => {
    const broken = VALID_FLY_TOML.replace('force_https = true', 'force_https = false')
      .replace('path = "/api/ready"', 'path = "/api/health"')
      .replace('172.16.0.0/12,fdaa::/16', '   ')
    const problems = validateFlyToml(broken)
    expect(problems).toEqual([
      'deploy/fly.toml: [http_service].force_https must be true (got false)',
      'deploy/fly.toml: [[http_service.checks]] must define a healthcheck with path = "/api/ready"',
      'deploy/fly.toml: [env].TRUSTED_PROXIES must be a non-empty string (got "   ")',
    ])
  })

  it('reports syntax errors before structural checks', () => {
    const problems = validateFlyToml('not valid toml')
    expect(problems).toEqual(['deploy/fly.toml line 1: invalid assignment "not valid toml"'])
  })
})
