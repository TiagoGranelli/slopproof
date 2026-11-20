import { Schema } from 'effect'
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from 'effect/http-api'
import { PostId } from './ids.ts'
import { WRITE_WINDOW_SECONDS, WRITES_PER_WINDOW } from './limits.ts'
import { Authentication, RequestValidation, WriteRateLimit } from './middleware.ts'
import { PageQuery, pageOf } from './pages.ts'
import { PostInput } from './post-input.ts'

const Post = Schema.Struct({
  id: PostId,
  body: Schema.String,
  authorName: Schema.String,
  createdAt: Schema.String,
  updatedAt: Schema.String,
}).annotate({ identifier: 'Post' })
export type Post = typeof Post.Type

const Created = Schema.suspend(() => Post).pipe(HttpApiSchema.status(201))

const PostPath = { id: PostId }

const PostPage = pageOf(Post).annotate({
  identifier: 'PostPage',
  description: 'One page of posts, newest first. `nextCursor` is null on the last page.',
})
export type PostPage = typeof PostPage.Type

export class PostNotFound extends Schema.TaggedError<PostNotFound, { readonly brand: unique symbol }>()(
  'PostNotFound',
  { id: PostId },
  { httpApiStatus: 404 },
) {}

export class PublicPosts extends HttpApiGroup.make('publicPosts')
  .add(HttpApiEndpoint.get('list', '/posts', { query: PageQuery, success: PostPage }).middleware(RequestValidation))
  .prefix('/api')
  .annotateMerge(OpenApi.annotations({ title: 'Public posts', description: 'Anonymous read access.' })) {}

export class MyPosts extends HttpApiGroup.make('myPosts')
  .add(
    HttpApiEndpoint.get('list', '/me/posts', { query: PageQuery, success: PostPage }).middleware(RequestValidation),
    HttpApiEndpoint.post('create', '/me/posts', {
      payload: PostInput,
      success: Created,
    })
      .middleware(RequestValidation)
      .middleware(WriteRateLimit),
    HttpApiEndpoint.patch('update', '/me/posts/:id', {
      params: PostPath,
      payload: PostInput,
      success: Post,
      error: PostNotFound,
    })
      .middleware(RequestValidation)
      .middleware(WriteRateLimit),
    HttpApiEndpoint.delete('remove', '/me/posts/:id', {
      params: PostPath,
      success: HttpApiSchema.NoContent,
      error: PostNotFound,
    }).middleware(WriteRateLimit),
  )
  .middleware(Authentication)
  .prefix('/api')
  .annotateMerge(
    OpenApi.annotations({
      title: 'My posts',
      description:
        `CRUD for the signed-in author. Creating, editing and deleting count together against a limit of ` +
        `${WRITES_PER_WINDOW} per ${WRITE_WINDOW_SECONDS} s per user; past it they answer 429.`,
    }),
  ) {}
