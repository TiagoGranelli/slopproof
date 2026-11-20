import '@tanstack/react-start/server-only'
import { Effect, Layer } from 'effect'
import { HttpApiBuilder } from 'effect/http-api'
import { Api } from '#/contract/api.ts'
import { ServiceUnavailable } from '#/contract/errors.ts'
import type { PostId } from '#/contract/ids.ts'
import { CurrentUser } from '#/contract/middleware.ts'
import { PostNotFound } from '#/contract/posts.ts'
import { DatabaseHealth } from '../db/health.ts'
import { pageRequest } from '../db/keyset.ts'
import { isDraining } from '../lifecycle.ts'
import { PostsRepo } from '../posts/repo.ts'

const readiness = (database: DatabaseHealth['Service']) =>
  Effect.suspend(() => {
    if (isDraining()) {
      return Effect.fail(new ServiceUnavailable({ message: 'Shutting down' }))
    }
    return database.ping.pipe(
      Effect.as({ status: 'ok' as const }),
      Effect.catchTag('DbError', () => Effect.fail(new ServiceUnavailable({ message: 'Database unavailable' }))),
    )
  })

const SystemHandlers = HttpApiBuilder.group(
  Api,
  'system',
  Effect.fn(function* (handlers) {
    const database = yield* DatabaseHealth
    return handlers
      .handle('health', () => Effect.succeed({ status: 'ok' as const }))
      .handle('ready', () => readiness(database))
  }),
)

const MeHandlers = HttpApiBuilder.group(Api, 'me', (handlers) =>
  handlers.handle('get', () => CurrentUser.use(Effect.succeed)),
)

const PublicPostsHandlers = HttpApiBuilder.group(
  Api,
  'publicPosts',
  Effect.fn(function* (handlers) {
    const repo = yield* PostsRepo
    return handlers.handle('list', ({ query }) => repo.listPublic(pageRequest(query)).pipe(Effect.orDie))
  }),
)

type Repo = PostsRepo['Service']

const updateOwnPost = (repo: Repo, id: PostId, body: string) =>
  Effect.gen(function* () {
    const author = yield* CurrentUser
    const updated = yield* repo.update(author, id, body).pipe(Effect.orDie)
    if (!updated) {
      return yield* new PostNotFound({ id })
    }
    return updated
  })

const removeOwnPost = (repo: Repo, id: PostId) =>
  Effect.gen(function* () {
    const author = yield* CurrentUser
    const removed = yield* repo.remove(author, id).pipe(Effect.orDie)
    if (!removed) {
      return yield* new PostNotFound({ id })
    }
  })

const MyPostsHandlers = HttpApiBuilder.group(
  Api,
  'myPosts',
  Effect.fn(function* (handlers) {
    const repo = yield* PostsRepo
    return handlers
      .handle('list', ({ query }) =>
        CurrentUser.use((author) => repo.listByAuthor(author, pageRequest(query))).pipe(Effect.orDie),
      )
      .handle('create', ({ payload }) =>
        CurrentUser.use((author) => repo.create(author, payload.body)).pipe(Effect.orDie),
      )
      .handle('update', ({ params, payload }) => updateOwnPost(repo, params.id, payload.body))
      .handle('remove', ({ params }) => removeOwnPost(repo, params.id))
  }),
)

export const ApiHandlers = Layer.mergeAll(SystemHandlers, MeHandlers, PublicPostsHandlers, MyPostsHandlers)
