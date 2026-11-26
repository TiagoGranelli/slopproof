import '@tanstack/react-start/server-only'
import { createHash } from 'node:crypto'
import { Predicate } from 'effect'

export const FLAGS = {
  auditLogStrict: false,
  clientTelemetry: false,
  prometheusMetrics: false,
} as const

export type FlagName = keyof typeof FLAGS

export interface RolloutRule {
  readonly enabled: boolean
  readonly rolloutPercent: number
}

export type FlagRule = boolean | RolloutRule
export type FlagOverrides = Partial<Record<FlagName, FlagRule>>

export interface FlagContext {
  readonly targetingKey?: string
  readonly userId?: string
}

export type FlagResolutionReason = 'DEFAULT' | 'STATIC' | 'TARGETING_MATCH'

export interface FlagEvaluation {
  readonly flagKey: FlagName
  readonly reason: FlagResolutionReason
  readonly value: boolean
}

const OVERRIDES_KEY = Symbol.for('app.featureFlags')
// Only this module writes this symbol-keyed overrides table across server bundles.
// oxlint-disable-next-line typescript/no-unsafe-type-assertion
const shared = globalThis as { [OVERRIDES_KEY]?: FlagOverrides }

const VALID_NAMES = Object.keys(FLAGS)

interface RawRolloutCandidate {
  readonly enabled?: unknown
  readonly rolloutPercent?: unknown
}

const isFlagName = (key: string): key is FlagName => Object.hasOwn(FLAGS, key)

const parseRolloutRule = (flagName: string, candidate: RawRolloutCandidate): RolloutRule => {
  const { enabled, rolloutPercent } = candidate
  if (typeof enabled !== 'boolean') {
    throw new TypeError(`FEATURE_FLAGS.${flagName}.enabled must be a boolean`)
  }
  if (
    typeof rolloutPercent !== 'number' ||
    !Number.isInteger(rolloutPercent) ||
    rolloutPercent < 0 ||
    rolloutPercent > 100
  ) {
    throw new RangeError(`FEATURE_FLAGS.${flagName}.rolloutPercent must be an integer between 0 and 100`)
  }
  return { enabled, rolloutPercent }
}

const parseRule = (flagName: string, candidate: unknown): FlagRule => {
  if (typeof candidate === 'boolean') {
    return candidate
  }
  if (Predicate.isObject(candidate) && !Array.isArray(candidate)) {
    return parseRolloutRule(flagName, candidate)
  }
  throw new TypeError(`FEATURE_FLAGS.${flagName} must be a boolean or { enabled, rolloutPercent }`)
}

const parseFlagsJsonObject = (trimmed: string): object => {
  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    throw new SyntaxError('FEATURE_FLAGS must be a valid JSON object')
  }
  if (!Predicate.isObject(parsed) || Array.isArray(parsed)) {
    throw new TypeError('FEATURE_FLAGS must be a JSON object mapping flag names to rules')
  }
  return parsed
}

export const parseFeatureFlagsEnv = (raw: string | undefined): FlagOverrides => {
  const trimmed = raw?.trim()
  if (!trimmed) {
    return {}
  }
  const parsed = parseFlagsJsonObject(trimmed)
  const overrides: FlagOverrides = {}
  for (const [key, value] of Object.entries(parsed)) {
    if (!isFlagName(key)) {
      throw new Error(`Unknown feature flag "${key}" in FEATURE_FLAGS (valid flags: ${VALID_NAMES.join(', ')})`)
    }
    overrides[key] = parseRule(key, value)
  }
  return overrides
}

export const setFeatureFlagOverrides = (overrides: FlagOverrides): void => {
  shared[OVERRIDES_KEY] = { ...overrides }
}

export const rolloutBucket = (flagName: FlagName, subject: string): number =>
  createHash('sha256').update(`${flagName}:${subject}`).digest().readUInt32BE(0) % 100

const evaluateRollout = (name: FlagName, rule: RolloutRule, context?: FlagContext): FlagEvaluation => {
  if (!rule.enabled || rule.rolloutPercent === 0) {
    return { flagKey: name, reason: 'STATIC', value: false }
  }
  if (rule.rolloutPercent === 100) {
    return { flagKey: name, reason: 'STATIC', value: true }
  }
  const subject = context?.targetingKey ?? context?.userId
  if (!subject) {
    return { flagKey: name, reason: 'TARGETING_MATCH', value: false }
  }
  return { flagKey: name, reason: 'TARGETING_MATCH', value: rolloutBucket(name, subject) < rule.rolloutPercent }
}

export const evaluateFlag = (name: FlagName, context?: FlagContext, overrides?: FlagOverrides): FlagEvaluation => {
  const active = overrides ?? shared[OVERRIDES_KEY]
  const rule = active?.[name]
  if (rule === undefined) {
    return { flagKey: name, reason: 'DEFAULT', value: FLAGS[name] }
  }
  if (typeof rule === 'boolean') {
    return { flagKey: name, reason: 'STATIC', value: rule }
  }
  return evaluateRollout(name, rule, context)
}

export const isFlagEnabled = (name: FlagName, context?: FlagContext, overrides?: FlagOverrides): boolean =>
  evaluateFlag(name, context, overrides).value
