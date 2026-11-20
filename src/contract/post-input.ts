import { Schema } from 'effect'
import { POST_MAX_LENGTH } from './limits.ts'
import { isFreeOfNul } from './stored-text.ts'

export const PostBody = Schema.String.check(
  isFreeOfNul,
  Schema.isTrimmed({ message: 'Remove the spaces before and after the text.' }),
  Schema.isMinLength(1, { message: 'Write something to post.' }),
  Schema.isMaxLength(POST_MAX_LENGTH, { message: `Use at most ${POST_MAX_LENGTH} characters.` }),
)

export const PostInput = Schema.Struct({ body: PostBody }).annotate({ identifier: 'PostInput' })
