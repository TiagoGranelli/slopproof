import { getTableConfig } from 'drizzle-orm/pg-core'
import * as fc from 'fast-check'
import { describe, expect, it, vi } from 'vitest'
import { UserId } from '#/contract/ids.ts'
import { hashAuditIp, recordAuditEvent, sanitizeAuditMetadata } from '#/server/audit/audit-log.ts'
import type {
  AuditEventInput,
  AuditInsertExecutor,
  AuditLogInsertRow,
  AuditMetadataInput,
  AuditRecordOptions,
} from '#/server/audit/audit-log.ts'
import { auditLog } from '#/server/db/schema/audit-log.ts'
import type { AuditMetadata, AuditMetadataValue, AuditOutcome } from '#/server/db/schema/audit-log.ts'
import { runWithRequestContext } from '#/server/request-context.ts'
import { captureLog } from './process-fakes.ts'

describe('auditLog Drizzle schema', () => {
  it('defines audit_log table, indexes, outcome check constraint, and nullable user foreign key', () => {
    const config = getTableConfig(auditLog)
    expect(config.name).toBe('audit_log')
    expect(config.columns.map((column) => column.name)).toEqual([
      'id',
      'occurred_at',
      'action',
      'actor_id',
      'ip_hash',
      'request_id',
      'outcome',
      'metadata',
    ])
    expect(config.indexes.map((idx) => idx.config.name)).toEqual([
      'audit_log_occurred_at_idx',
      'audit_log_actor_occurred_idx',
      'audit_log_action_occurred_idx',
    ])
    expect(config.checks.map((constraint) => constraint.name)).toEqual(['audit_log_outcome_check'])
    expect(config.foreignKeys).toHaveLength(1)
    expect(config.foreignKeys[0]?.reference().foreignTable).toBeDefined()
  })
})

describe('hashAuditIp', () => {
  it('produces deterministic salted 32-char hex prefixes and returns null if ip or salt is missing', () => {
    const first = hashAuditIp(' 203.0.113.5 ', 'salt-a')
    const second = hashAuditIp('203.0.113.5', 'salt-a')
    const differentSalt = hashAuditIp('203.0.113.5', 'salt-b')
    expect(first).toBe(second)
    expect(first).toMatch(/^[0-9a-f]{32}$/)
    expect(first).not.toBe(differentSalt)
    expect(hashAuditIp(null, 'salt-a')).toBeNull()
    expect(hashAuditIp('  ', 'salt-a')).toBeNull()
    expect(hashAuditIp('203.0.113.5', '')).toBeNull()
    expect(hashAuditIp('203.0.113.5', undefined)).toBeNull()
  })

  it('never echoes raw IP addresses in the hash', () => {
    fc.assert(
      fc.property(fc.ipV4(), fc.string({ minLength: 4 }), (ip, salt) => {
        const trimmedSalt = salt.trim()
        const hashed = hashAuditIp(ip, trimmedSalt)
        expect(hashed === null || (hashed.length === 32 && !hashed.includes(ip))).toBe(true)
      }),
    )
  })
})

describe('sanitizeAuditMetadata', () => {
  it('allowlists safe keys, drops PII/non-primitives, strips control chars, and caps lengths', () => {
    const raw: AuditMetadataInput = {
      email: 'alice@example.com',
      method: 'POST\r\n\u0000\u007F',
      nested: { secret: 'nope' },
      path: '/api/auth/sign-in',
      provider: 'email',
      reason: 'x'.repeat(200),
      resourceId: null,
      statusCode: 401,
      targetType: true,
      token: 'secret',
    }
    const clean: AuditMetadata = sanitizeAuditMetadata(raw)
    const sampleValue: AuditMetadataValue | undefined = clean.method
    expect(sampleValue).toBe('POST')
    expect(clean).toEqual({
      method: 'POST',
      path: '/api/auth/sign-in',
      provider: 'email',
      reason: 'x'.repeat(160),
      statusCode: 401,
      targetType: true,
    })
    expect(sanitizeAuditMetadata(undefined)).toEqual({})
    expect(sanitizeAuditMetadata({ statusCode: Number.NaN })).toEqual({})
  })
})

describe('recordAuditEvent', () => {
  it('writes sanitized audit rows with request context correlation and logs without raw IP', async () => {
    const lines = captureLog()
    const inserted: Array<AuditLogInsertRow> = []
    const database: AuditInsertExecutor = {
      insert: () => ({
        values: async (row) => {
          inserted.push(row)
          return undefined
        },
      }),
    }
    const outcome: AuditOutcome = 'success'
    const input: AuditEventInput = {
      action: 'auth.sign_in',
      actorId: UserId.make('user-1'),
      ip: '198.51.100.10',
      ipSalt: 'pepper',
      metadata: { email: 'hidden@example.com', method: 'POST', statusCode: 200 },
      outcome,
    }
    const headers = new Headers({ 'x-request-id': 'req-audit-1' })
    const saved = await runWithRequestContext(headers, () => recordAuditEvent(database, input))
    expect(saved).toBe(true)
    expect(inserted).toHaveLength(1)
    expect(inserted[0]).toMatchObject({
      action: 'auth.sign_in',
      actorId: 'user-1',
      metadata: { method: 'POST', statusCode: 200 },
      outcome: 'success',
      requestId: 'req-audit-1',
    })
    expect(JSON.stringify(lines[0])).not.toContain('198.51.100.10')
  })

  it('defaults nullable fields and degrades gracefully unless strict mode is enabled', async () => {
    const lines = captureLog()
    const values = vi
      .fn<(row: AuditLogInsertRow) => Promise<undefined>>()
      .mockRejectedValue(new Error('db unavailable'))
    const database: AuditInsertExecutor = { insert: () => ({ values }) }
    const input: AuditEventInput = { action: 'auth.sign_in', outcome: 'failure' }
    const nonStrict: AuditRecordOptions = { strict: false }
    expect(await recordAuditEvent(database, input, nonStrict)).toBe(false)
    expect(values.mock.calls[0]?.[0]).toMatchObject({ actorId: null, ipHash: null, requestId: null })
    await expect(recordAuditEvent(database, input, { strict: true })).rejects.toThrow('db unavailable')
    expect(lines.some((entry) => entry.msg === 'audit log write failed')).toBe(true)
  })
})
