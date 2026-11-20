import { Schema, SchemaTransformation } from 'effect'
import { PostBody } from '#/contract/post-input.ts'

export const PostDraft = Schema.Struct({
  body: Schema.String.pipe(Schema.decodeTo(PostBody, SchemaTransformation.trim())),
})
