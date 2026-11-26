import { decodeTo, String as SchemaString, Struct } from 'effect/Schema'
import { trim } from 'effect/SchemaTransformation'
import { PostBody } from '#/contract/post-input.ts'

export const PostDraft = Struct({
  body: SchemaString.pipe(decodeTo(PostBody, trim())),
})
