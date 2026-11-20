import '@tanstack/react-start/server-only'
import { desc, sql, type SQL } from 'drizzle-orm'
import type { PgColumn } from 'drizzle-orm/pg-core'
import { POSTS_PAGE_DEFAULT } from '#/contract/limits.ts'
import type { PageCursor } from '#/contract/pages.ts'

export interface PageRequest {
  readonly cursor?: PageCursor | undefined
  readonly limit: number
}

export const pageRequest = (query: {
  readonly cursor?: PageRequest['cursor']
  readonly limit?: number
}): PageRequest => ({
  cursor: query.cursor,
  limit: query.limit ?? POSTS_PAGE_DEFAULT,
})

export interface Keyset {
  readonly after: (cursor: PageCursor | undefined) => SQL | undefined
  readonly cursorAt: SQL<string>
  readonly newestFirst: ReadonlyArray<SQL>
}

export const keyset = (table: { readonly createdAt: PgColumn; readonly id: PgColumn }): Keyset => ({
  after: (cursor) =>
    cursor
      ? sql`(${table.createdAt}, ${table.id}) < (${cursor.createdAt}::timestamptz, ${cursor.id}::uuid)`
      : undefined,
  cursorAt: sql<string>`to_char(${table.createdAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
  newestFirst: [desc(table.createdAt), desc(table.id)],
})

interface KeyedRow {
  readonly cursorAt: string
  readonly id: string
}

export interface KeysetPage<Item> {
  readonly items: Array<Item>
  readonly nextCursor: PageCursor | null
}

export const toPage = <Row extends KeyedRow, Item>(
  rows: ReadonlyArray<Row>,
  limit: number,
  toItem: (row: Row) => Item,
): KeysetPage<Item> => {
  const shown = rows.slice(0, limit)
  const last = shown.at(-1)
  return {
    items: shown.map((row) => toItem(row)),
    nextCursor: rows.length > limit && last ? { createdAt: last.cursorAt, id: last.id } : null,
  }
}
