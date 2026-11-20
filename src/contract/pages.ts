import { Schema, SchemaTransformation } from 'effect'
import { POSTS_PAGE_DEFAULT, POSTS_PAGE_MAX } from './limits.ts'

const CURSOR_TIME = /^(?!0000)\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])T([01]\d|2[0-3]):[0-5]\d:[0-5]\d\.\d{6}Z$/
const isCalendarDate = Schema.makeFilter<string>(
  (value) => {
    const date = new Date(`${value.slice(0, 23)}Z`)
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 23) === value.slice(0, 23)
  },
  { expected: 'a valid calendar date' },
)

export const PageCursor = Schema.String.annotate({
  identifier: 'PageCursor',
  description: 'Opaque cursor from `nextCursor` of the previous page. Omit it for the first page.',
}).pipe(
  Schema.decodeTo(Schema.String, SchemaTransformation.stringFromBase64UrlString),
  Schema.decodeTo(
    Schema.fromJsonString(
      Schema.Struct({
        createdAt: Schema.String.check(Schema.isPattern(CURSOR_TIME), isCalendarDate),
        id: Schema.String.check(Schema.isUUID()),
      }),
    ),
  ),
)
export type PageCursor = typeof PageCursor.Type

const PageLimit = Schema.String.check(Schema.isPattern(/^\d{1,3}$/u, { expected: 'a whole number' }))
  .annotate({ description: `Items per page, 1 to ${POSTS_PAGE_MAX}. Default ${POSTS_PAGE_DEFAULT}.` })
  .pipe(
    Schema.decodeTo(
      Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: POSTS_PAGE_MAX })),
      SchemaTransformation.numberFromString,
    ),
  )

export const PageQuery = { cursor: Schema.optionalKey(PageCursor), limit: Schema.optionalKey(PageLimit) }

export const pageOf = <Item extends Schema.Top>(
  itemSchema: Item,
): Schema.Struct<{ readonly items: Schema.$Array<Item>; readonly nextCursor: Schema.NullOr<typeof PageCursor> }> =>
  Schema.Struct({ items: Schema.Array(itemSchema), nextCursor: Schema.NullOr(PageCursor) })
