import { Schema } from 'effect'

export const UserId = Schema.String.pipe(Schema.brand('UserId'))
export type UserId = typeof UserId.Type

export const PostId = Schema.String.pipe(Schema.brand('PostId'))
export type PostId = typeof PostId.Type
