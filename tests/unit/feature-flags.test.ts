import * as fc from 'fast-check'
import { afterEach, describe, expect, it } from 'vitest'
import {
  evaluateFlag,
  FLAGS,
  isFlagEnabled,
  parseFeatureFlagsEnv,
  rolloutBucket,
  setFeatureFlagOverrides,
} from '#/server/feature-flags.ts'
import type {
  FlagContext,
  FlagEvaluation,
  FlagName,
  FlagOverrides,
  FlagResolutionReason,
  FlagRule,
  RolloutRule,
} from '#/server/feature-flags.ts'

describe('parseFeatureFlagsEnv', () => {
  it('returns empty overrides for missing or blank input and parses valid boolean and rollout rules', () => {
    expect(parseFeatureFlagsEnv(undefined)).toEqual({})
    expect(parseFeatureFlagsEnv('   ')).toEqual({})
    const raw = JSON.stringify({
      auditLogStrict: true,
      clientTelemetry: { enabled: true, rolloutPercent: 25 },
      prometheusMetrics: false,
    })
    const parsed: FlagOverrides = parseFeatureFlagsEnv(raw)
    expect(parsed).toEqual({
      auditLogStrict: true,
      clientTelemetry: { enabled: true, rolloutPercent: 25 },
      prometheusMetrics: false,
    })
  })

  it('rejects malformed JSON, non-objects, unknown flags, and invalid rules', () => {
    expect(() => parseFeatureFlagsEnv('{bad')).toThrow('valid JSON object')
    expect(() => parseFeatureFlagsEnv('[]')).toThrow('JSON object mapping flag names')
    expect(() => parseFeatureFlagsEnv('null')).toThrow('JSON object mapping flag names')
    expect(() => parseFeatureFlagsEnv('{"unknownFlag":true}')).toThrow('Unknown feature flag "unknownFlag"')
    expect(() => parseFeatureFlagsEnv('{"clientTelemetry":"yes"}')).toThrow('boolean or { enabled, rolloutPercent }')
    expect(() => parseFeatureFlagsEnv('{"clientTelemetry":[]}')).toThrow('boolean or { enabled, rolloutPercent }')
    expect(() => parseFeatureFlagsEnv('{"clientTelemetry":{"enabled":"yes","rolloutPercent":10}}')).toThrow(
      'enabled must be a boolean',
    )
    expect(() => parseFeatureFlagsEnv('{"clientTelemetry":{"enabled":true,"rolloutPercent":101}}')).toThrow(
      'integer between 0 and 100',
    )
    expect(() => parseFeatureFlagsEnv('{"clientTelemetry":{"enabled":true,"rolloutPercent":12.5}}')).toThrow(
      'integer between 0 and 100',
    )
  })
})

describe('evaluateFlag and isFlagEnabled', () => {
  afterEach(() => {
    setFeatureFlagOverrides({})
  })

  it('uses safe defaults and global overrides when no local overrides are passed', () => {
    const flag: FlagName = 'prometheusMetrics'
    const fallback: FlagEvaluation = evaluateFlag(flag)
    const expectedReason: FlagResolutionReason = 'DEFAULT'
    expect(fallback).toEqual({ flagKey: flag, reason: expectedReason, value: FLAGS[flag] })
    expect(isFlagEnabled(flag)).toBe(false)
    setFeatureFlagOverrides({ prometheusMetrics: true })
    expect(evaluateFlag(flag)).toEqual({ flagKey: flag, reason: 'STATIC', value: true })
    expect(isFlagEnabled(flag)).toBe(true)
  })

  it('handles 0%, 100%, disabled, missing subject, and deterministic targeted rollouts', () => {
    const disabledRule: RolloutRule = { enabled: false, rolloutPercent: 50 }
    const fullRule: FlagRule = { enabled: true, rolloutPercent: 100 }
    const partialRule: FlagRule = { enabled: true, rolloutPercent: 50 }
    const userContext: FlagContext = { userId: 'user-123' }
    expect(evaluateFlag('clientTelemetry', userContext, { clientTelemetry: disabledRule }).value).toBe(false)
    expect(
      evaluateFlag('clientTelemetry', userContext, { clientTelemetry: { enabled: true, rolloutPercent: 0 } }).value,
    ).toBe(false)
    expect(evaluateFlag('clientTelemetry', userContext, { clientTelemetry: fullRule })).toEqual({
      flagKey: 'clientTelemetry',
      reason: 'STATIC',
      value: true,
    })
    expect(evaluateFlag('clientTelemetry', undefined, { clientTelemetry: partialRule })).toEqual({
      flagKey: 'clientTelemetry',
      reason: 'TARGETING_MATCH',
      value: false,
    })
    const bucket = rolloutBucket('clientTelemetry', 'user-123')
    expect(
      isFlagEnabled('clientTelemetry', userContext, { clientTelemetry: { enabled: true, rolloutPercent: bucket + 1 } }),
    ).toBe(true)
    expect(
      isFlagEnabled(
        'clientTelemetry',
        { targetingKey: 'user-123' },
        { clientTelemetry: { enabled: true, rolloutPercent: bucket } },
      ),
    ).toBe(false)
  })

  it('produces deterministic buckets in [0, 99] for arbitrary subjects', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1 }), (subject) => {
        const first = rolloutBucket('clientTelemetry', subject)
        const second = rolloutBucket('clientTelemetry', subject)
        expect(first).toBe(second)
        expect(first).toBeGreaterThanOrEqual(0)
        expect(first).toBeLessThan(100)
      }),
    )
  })
})
