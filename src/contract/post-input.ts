import { isMaxLength, isMinLength, isTrimmed, String as SchemaString, Struct } from 'effect/Schema'
import { POST_MAX_LENGTH } from './limits.ts'
import { isFreeOfNul } from './stored-text.ts'

export const PostBody = SchemaString.check(
  isFreeOfNul,
  isTrimmed({ message: 'Remove the spaces before and after the text.' }),
  isMinLength(1, { message: 'Write something to post.' }),
  isMaxLength(POST_MAX_LENGTH, { message: `Use at most ${POST_MAX_LENGTH} characters.` }),
)

export const PostInput = Struct({ body: PostBody }).annotate({ identifier: 'PostInput' })
