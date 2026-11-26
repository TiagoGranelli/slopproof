import '@tanstack/react-start/server-only'
import { createHmac } from 'node:crypto'
import type { UserId } from '#/contract/ids.ts'
import type { Json } from '#/contract/json.ts'
import { auditLog } from '../db/schema/audit-log.ts'
import type { AuditMetadata, AuditMetadataValue, AuditOutcome } from '../db/schema/audit-log.ts'
import { log } from '../log.ts'
import { currentRequestContext } from '../request-context.ts'

export type AuditMetadataInput = Readonly<Record<string, Json | undefined>>

export interface AuditLogInsertRow {
  readonly action: string
  readonly actorId: UserId | null
  readonly ipHash: string | null
  readonly metadata: AuditMetadata
  readonly outcome: AuditOutcome
  readonly requestId: string | null
}

export interface AuditInsertExecutor {
  readonly insert: (table: typeof auditLog) => {
    readonly values: (row: AuditLogInsertRow) => PromiseLike<object | undefined>
  }
}

export interface AuditEventInput {
  readonly action: string
  readonly actorId?: UserId | null
  readonly ip?: string | null
  readonly ipSalt?: string
  readonly metadata?: AuditMetadataInput
  readonly outcome: AuditOutcome
  readonly requestId?: string | null
}

export interface AuditRecordOptions {
  readonly strict?: boolean
}

const ALLOWED_METADATA_KEYS = new Set([
  'method',
  'path',
  'provider',
  'reason',
  'resourceId',
  'resourceType',
  'statusCode',
  'targetType',
])

const IP_HASH_HEX_LENGTH = 32
const MAX_METADATA_STRING_LENGTH = 160

const DEL_CHAR = String.fromCodePoint(127)

const stripControlChars = (raw: string): string => {
  let cleaned = ''
  for (const character of raw) {
    cleaned += character < ' ' || character === DEL_CHAR ? ' ' : character
  }
  return cleaned.replaceAll(/\s+/g, ' ').trim()
}

export const hashAuditIp = (ip: string | null | undefined, salt: string | undefined): string | null => {
  const normalizedIp = ip?.trim().toLowerCase()
  const normalizedSalt = salt?.trim()
  if (!normalizedIp || !normalizedSalt) {
    return null
  }
  return createHmac('sha256', normalizedSalt).update(normalizedIp).digest('hex').slice(0, IP_HASH_HEX_LENGTH)
}

const sanitizeMetadataValue = (value: Json | undefined): AuditMetadataValue | undefined => {
  if (typeof value === 'boolean') {
    return value
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined
  }
  if (typeof value === 'string') {
    return stripControlChars(value).slice(0, MAX_METADATA_STRING_LENGTH)
  }
  return undefined
}

export const sanitizeAuditMetadata = (raw: AuditMetadataInput | undefined): AuditMetadata => {
  if (!raw) {
    return {}
  }
  const sanitized: Record<string, AuditMetadataValue> = {}
  for (const [key, value] of Object.entries(raw)) {
    if (!ALLOWED_METADATA_KEYS.has(key)) {
      continue
    }
    const clean = sanitizeMetadataValue(value)
    if (clean !== undefined) {
      sanitized[key] = clean
    }
  }
  return sanitized
}

const buildAuditRow = (input: AuditEventInput): AuditLogInsertRow => ({
  action: input.action,
  actorId: input.actorId ?? null,
  ipHash: hashAuditIp(input.ip, input.ipSalt),
  metadata: sanitizeAuditMetadata(input.metadata),
  outcome: input.outcome,
  requestId: input.requestId ?? currentRequestContext()?.requestId ?? null,
})

const logAuditEntry = (row: AuditLogInsertRow): void => {
  log('info', 'audit', {
    action: row.action,
    actorId: row.actorId,
    ipHash: row.ipHash,
    outcome: row.outcome,
    requestId: row.requestId,
  })
}

const logAuditFailure = (row: AuditLogInsertRow, error: unknown): void => {
  log('error', 'audit log write failed', {
    action: row.action,
    error,
    outcome: row.outcome,
    requestId: row.requestId,
  })
}

export const recordAuditEvent = async (
  database: AuditInsertExecutor,
  input: AuditEventInput,
  options?: AuditRecordOptions,
): Promise<boolean> => {
  const row = buildAuditRow(input)
  logAuditEntry(row)
  try {
    await database.insert(auditLog).values(row)
    return true
  } catch (error) {
    logAuditFailure(row, error)
    if (options?.strict) {
      throw error
    }
    return false
  }
}
