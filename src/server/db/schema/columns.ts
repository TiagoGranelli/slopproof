import { sql } from 'drizzle-orm'
import { check, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import type { AnyPgColumn } from 'drizzle-orm/pg-core'
import type { UserId } from '../../../contract/ids.ts'
import { user } from './auth.ts'

export const uuidv7Id = () =>
  uuid('id')
    .primaryKey()
    .default(sql`uuidv7()`)

export const authorId = () =>
  text('author_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' })
    .$type<UserId>()

export const createdAt = () => timestamp('created_at', { withTimezone: true }).defaultNow().notNull()

export const updatedAt = () =>
  timestamp('updated_at', { withTimezone: true })
    .defaultNow()
    .notNull()
    .$onUpdate(() => sql`now()`)

export const trimmedTextCheck = (name: string, column: AnyPgColumn, maxLength: number) =>
  check(
    name,
    // A constant from the contract, inlined because DDL takes no parameters.
    // fallow-ignore-next-line security-sink
    sql`char_length(${column}) between 1 and ${sql.raw(String(maxLength))} and ${column} = btrim(${column})`,
  )
