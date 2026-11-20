import { index, pgTable, text } from 'drizzle-orm/pg-core'
import type { PostId } from '../../../contract/ids.ts'
import { POST_MAX_LENGTH } from '../../../contract/limits.ts'
import { authorId, createdAt, trimmedTextCheck, updatedAt, uuidv7Id } from './columns.ts'

export const post = pgTable(
  'post',
  {
    id: uuidv7Id().$type<PostId>(),
    authorId: authorId(),
    body: text('body').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('post_keyset_idx').on(t.createdAt, t.id),
    index('post_author_keyset_idx').on(t.authorId, t.createdAt, t.id),
    trimmedTextCheck('post_body_check', t.body, POST_MAX_LENGTH),
  ],
)
