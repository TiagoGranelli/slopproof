import { sql } from 'drizzle-orm'
import { check, index, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core'
import type { UserId } from '../../../contract/ids.ts'
import { user } from './auth.ts'
import { uuidv7Id } from './columns.ts'

export type AuditOutcome = 'denied' | 'failure' | 'success'
export type AuditMetadataValue = boolean | number | string
export type AuditMetadata = Readonly<Record<string, AuditMetadataValue>>

export const auditLog = pgTable(
  'audit_log',
  {
    id: uuidv7Id(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).defaultNow().notNull(),
    action: text('action').notNull(),
    actorId: text('actor_id')
      .references(() => user.id, { onDelete: 'set null' })
      .$type<UserId>(),
    ipHash: text('ip_hash'),
    requestId: text('request_id'),
    outcome: text('outcome').$type<AuditOutcome>().notNull(),
    metadata: jsonb('metadata').$type<AuditMetadata>().default({}).notNull(),
  },
  (t) => [
    index('audit_log_occurred_at_idx').on(t.occurredAt, t.id),
    index('audit_log_actor_occurred_idx').on(t.actorId, t.occurredAt),
    index('audit_log_action_occurred_idx').on(t.action, t.occurredAt),
    check('audit_log_outcome_check', sql`${t.outcome} in ('success', 'denied', 'failure')`),
  ],
)
